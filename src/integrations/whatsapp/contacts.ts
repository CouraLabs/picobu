import { withLock } from "../../libs/lock";
import { options } from "../../libs/options";
import { normalizePhone } from "./phone";

/** A known WhatsApp counterparty, kept fresh from traffic + contact events. */
export type WwpContact = {
  /** Bare digits, e.g. `15551234567`. */
  phone: string;
  /** Push/saved name when known, otherwise null. */
  name: string | null;
  /** Last inbound/outbound activity (epoch ms). */
  lastAt: number;
};

type ContactsFile = { contacts: WwpContact[] };

/** Merge cap so the contacts book can't grow unbounded. */
const MAX_CONTACTS = 200;

/**
 * Pure merge: one entry per normalized phone; `lastAt` never goes back; a
 * fresh non-empty name replaces the stored one, otherwise the name survives.
 * Newest activity first.
 */
export const mergeContacts = (
  existing: readonly WwpContact[],
  incoming: readonly { phone: string; name?: string | null; lastAt: number }[],
): WwpContact[] => {
  const byPhone = new Map<string, WwpContact>();
  for (const c of existing) {
    const phone = normalizePhone(c.phone);
    if (phone) byPhone.set(phone, { phone, name: c.name?.trim() || null, lastAt: c.lastAt });
  }
  for (const inc of incoming) {
    const phone = normalizePhone(inc.phone);
    if (!phone) continue;
    const prior = byPhone.get(phone);
    byPhone.set(phone, {
      phone,
      name: inc.name?.trim() || prior?.name || null,
      lastAt: Math.max(inc.lastAt, prior?.lastAt ?? 0),
    });
  }
  return Array.from(byPhone.values()).sort((a, b) => b.lastAt - a.lastAt);
};

/** Contacts persist under `<dir>/contacts.json` (`dir` overridable for tests). */
export const contactsFilePath = (dir: string = `${options.app.systemDir}/whatsapp`): string =>
  `${dir}/contacts.json`;

/** All known contacts, newest activity first (missing/corrupt file = empty). */
export const listWwpContacts = async (dir?: string): Promise<WwpContact[]> => {
  const file = Bun.file(contactsFilePath(dir));
  if (!(await file.exists())) return [];
  try {
    const parsed = (await file.json()) as Partial<ContactsFile>;
    return (parsed.contacts ?? [])
      .map((c) => ({ ...c, phone: normalizePhone(c.phone) }))
      .filter((c) => c.phone)
      .sort((a, b) => b.lastAt - a.lastAt);
  } catch {
    return [];
  }
};

/** Upsert contacts (fire-and-forget from the connection handlers). */
export const recordWwpContacts = async (
  incoming: readonly { phone: string; name?: string | null; lastAt?: number }[],
  dir?: string,
): Promise<void> => {
  const usable = incoming.filter((c) => normalizePhone(c.phone));
  if (!usable.length) return;
  const path = contactsFilePath(dir);
  // Read-merge-write under one lock: concurrent recorders (messages.upsert +
  // contacts.upsert land together) would otherwise drop each other's updates.
  await withLock(path, async () => {
    const file = Bun.file(path);
    const existing: readonly WwpContact[] = (await file.exists())
      ? ((await file.json().catch(() => ({}))) as Partial<ContactsFile>).contacts ?? []
      : [];
    const merged = mergeContacts(
      existing,
      incoming.map((c) => ({ ...c, lastAt: c.lastAt ?? Date.now() })),
    ).slice(0, MAX_CONTACTS);
    await Bun.write(path, JSON.stringify({ contacts: merged }, null, 2));
  });
};
