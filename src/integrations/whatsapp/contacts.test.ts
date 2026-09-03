import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listWwpContacts, mergeContacts, recordWwpContacts } from "@integrations/whatsapp/contacts.ts";

describe("contact merge", () => {
  test("upserts new contacts, keyed by normalized phone", () => {
    const merged = mergeContacts([], [
      { phone: "+1 (555) 123-4567", name: "Alice", lastAt: 100 },
      { phone: "", name: "dropped", lastAt: 999 },
    ]);
    expect(merged).toEqual([{ phone: "15551234567", name: "Alice", lastAt: 100 }]);
  });

  test("lastAt never goes back for a known phone", () => {
    const merged = mergeContacts([{ phone: "15551234567", name: "Old", lastAt: 100 }], [
      { phone: "+1555-123-4567", name: null, lastAt: 50 },
    ]);
    expect(merged[0]?.lastAt).toBe(100);
  });

  test("a fresh non-empty name replaces the stored one; otherwise it survives", () => {
    const merged = mergeContacts([{ phone: "15551234567", name: "Alice", lastAt: 1 }], [
      { phone: "15551234567", name: "  Bob  ", lastAt: 200 },
      { phone: "15551234567", name: "  ", lastAt: 300 },
    ]);
    expect(merged[0]?.name).toBe("Bob");
  });

  test("empty-phone entries are ignored", () => {
    const merged = mergeContacts([], [
      { phone: "", name: "x", lastAt: 2 },
      { phone: "+++", name: "y", lastAt: 3 },
    ]);
    expect(merged).toEqual([]);
  });
});

describe("contacts file persistence", () => {
  test("record then list round-trips through the contacts file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-contacts-"));
    try {
      await recordWwpContacts(
        [
          { phone: "+1 (555) 123-4567", name: "Alice", lastAt: 100 },
          { phone: "15559998888", name: null, lastAt: 50 },
        ],
        dir,
      );
      await recordWwpContacts([{ phone: "1555000", name: "Bob", lastAt: 10 }], dir);
      // A newer contactless update keeps the stored name.
      await recordWwpContacts([{ phone: "15551234567", name: null, lastAt: 900 }], dir);

      const contacts = await listWwpContacts(dir);
      expect(contacts.map((c) => c.phone)).toEqual(["15551234567", "15559998888", "1555000"]);
      expect(contacts[0]?.name).toBe("Alice");
      expect(contacts[1]?.name).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a corrupt file lists as empty and is repaired on next record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-contacts-"));
    try {
      await Bun.write(join(dir, "contacts.json"), "{not json");
      expect(await listWwpContacts(dir)).toEqual([]);
      await recordWwpContacts([{ phone: "15551234567", name: "Bob", lastAt: 1 }], dir);
      expect((await listWwpContacts(dir))[0]?.phone).toBe("15551234567");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
