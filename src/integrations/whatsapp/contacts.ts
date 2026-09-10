import { options } from '@config/options.ts'
import { normalizePhone } from '@integrations/whatsapp/phone.ts'
import { withLock } from '@shared/lock.ts'

export type WwpContact = {
  phone: string
  name: string | null
  lastAt: number
}
type ContactsFile = { contacts: WwpContact[] }

const MAX_CONTACTS = 200

export const mergeContacts = (existing: readonly WwpContact[], incoming: readonly { phone: string; name?: string | null; lastAt: number }[]): WwpContact[] => {
  const byPhone = new Map<string, WwpContact>()
  for (const c of existing) {
    if (typeof (c as { phone?: unknown }).phone !== 'string') continue
    const phone = normalizePhone((c as { phone: string }).phone)
    if (phone) byPhone.set(phone, { phone, name: c.name?.trim() || null, lastAt: c.lastAt })
  }
  for (const inc of incoming) {
    if (typeof (inc as { phone?: unknown }).phone !== 'string') continue
    const phone = normalizePhone((inc as { phone: string }).phone)
    if (!phone) continue
    const prior = byPhone.get(phone)
    byPhone.set(phone, {
      phone,
      name: inc.name?.trim() || prior?.name || null,
      lastAt: Math.max(inc.lastAt, prior?.lastAt ?? 0),
    })
  }
  return Array.from(byPhone.values()).sort((a, b) => b.lastAt - a.lastAt)
}

export const contactsFilePath = (dir: string = `${options.app.systemDir}/whatsapp`): string => `${dir}/contacts.json`

export const listWwpContacts = async (dir?: string): Promise<WwpContact[]> => {
  const file = Bun.file(contactsFilePath(dir))
  if (!(await file.exists())) return []
  try {
    const parsed = (await file.json()) as Partial<ContactsFile>
    return (parsed.contacts ?? [])
      .filter((c) => c && typeof (c as { phone?: unknown }).phone === 'string')
      .map((c) => ({ ...c, phone: normalizePhone((c as { phone: string }).phone) }))
      .filter((c) => c.phone)
      .sort((a, b) => b.lastAt - a.lastAt)
  } catch {
    return []
  }
}

export const recordWwpContacts = async (incoming: readonly { phone: string; name?: string | null; lastAt?: number }[], dir?: string): Promise<void> => {
  const usable = incoming.filter((c) => c && typeof (c as { phone?: unknown }).phone === 'string' && normalizePhone((c as { phone: string }).phone))
  if (!usable.length) return
  const path = contactsFilePath(dir)
  await withLock(path, async () => {
    const file = Bun.file(path)
    const existing: readonly WwpContact[] = (await file.exists()) ? (((await file.json().catch(() => ({}))) as Partial<ContactsFile>).contacts ?? []) : []
    const merged = mergeContacts(
      existing,
      incoming.map((c) => ({ ...c, lastAt: c.lastAt ?? Date.now() })),
    ).slice(0, MAX_CONTACTS)
    await Bun.write(path, JSON.stringify({ contacts: merged }, null, 2))
  })
}
