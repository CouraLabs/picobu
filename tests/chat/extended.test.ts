import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jidToPhone } from "../../src/integrations/whatsapp/phone.ts";
import { contactsFilePath, listWwpContacts, mergeContacts, recordWwpContacts } from "../../src/integrations/whatsapp/contacts.ts";
import { whatsappStore } from "../../src/integrations/whatsapp/whatsapp-store.ts";
import { addTodayTask, removeTodayTask, sendWwpMessage, whatsappFilePath } from "../../src/integrations/whatsapp/actions.ts";
import { wwpTools } from "../../src/integrations/whatsapp/wwp-tools.ts";
import { options } from "../../src/config/options.ts";
import { initLockDir } from "../../src/shared/lock.ts";

describe("jidToPhone", () => {
  test("strips s.whatsapp.net suffix", () => {
    expect(jidToPhone("5511999998888@s.whatsapp.net")).toBe("5511999998888");
  });
  test("strips device suffix after colon", () => {
    expect(jidToPhone("123456:12@s.whatsapp.net")).toBe("123456");
  });
  test("keeps digits for lid jids", () => {
    expect(jidToPhone("987654321@lid")).toBe("987654321");
  });
  test("normalizes group jids to digits", () => {
    expect(jidToPhone("12345-678@g.us")).toBe("12345678");
  });
  test("returns empty for empty jid", () => {
    expect(jidToPhone("")).toBe("");
  });
});

describe("mergeContacts", () => {
  test("skips corrupt entries without string phones", () => {
    const merged = mergeContacts(
      [{ phone: "1555", name: "A", lastAt: 1 }, { phone: 42, name: "x", lastAt: 2 } as unknown as { phone: string; name: string | null; lastAt: number }, {} as unknown as { phone: string; name: string | null; lastAt: number }],
      [{ phone: "", name: "y", lastAt: 3 } as unknown as { phone: string; name?: string | null; lastAt: number }],
    );
    expect(merged).toEqual([{ phone: "1555", name: "A", lastAt: 1 }]);
  });
  test("keeps prior name trims incoming and takes max lastAt", () => {
    const merged = mergeContacts(
      [{ phone: "+1 (555)", name: "Old", lastAt: 10 }],
      [{ phone: "1555", lastAt: 20 }, { phone: "999", name: "  New  ", lastAt: 3 }],
    );
    expect(merged).toEqual([
      { phone: "1555", name: "Old", lastAt: 20 },
      { phone: "999", name: "New", lastAt: 3 },
    ]);
  });
  test("sorts by lastAt descending", () => {
    const merged = mergeContacts([], [
      { phone: "111", lastAt: 1 },
      { phone: "222", lastAt: 9 },
      { phone: "333", lastAt: 5 },
    ]);
    expect(merged.map((c) => c.phone)).toEqual(["222", "333", "111"]);
  });
});

describe("contacts file", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "picobu-chat-contacts-"));
    initLockDir(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  test("list returns empty when file is missing", async () => {
    expect(await listWwpContacts(dir)).toEqual([]);
  });
  test("list returns empty for corrupt json", async () => {
    await Bun.write(contactsFilePath(dir), "garbage{{{");
    expect(await listWwpContacts(dir)).toEqual([]);
  });
  test("list skips corrupt entries and normalizes phones", async () => {
    await Bun.write(
      contactsFilePath(dir),
      JSON.stringify({ contacts: [{ phone: "+1-555", name: "A", lastAt: 5 }, { nope: 1 }, { phone: 42 }, { phone: "   " }, null] }),
    );
    expect(await listWwpContacts(dir)).toEqual([{ phone: "1555", name: "A", lastAt: 5 }]);
  });
  test("record and list roundtrip in tmp", async () => {
    await recordWwpContacts([{ phone: "+1 (555) 000-1111", name: "Bob" }], dir);
    await recordWwpContacts([], dir);
    const listed = await listWwpContacts(dir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.phone).toBe("15550001111");
    expect(listed[0]?.name).toBe("Bob");
    expect(typeof listed[0]?.lastAt).toBe("number");
  });
});

describe("whatsappStore", () => {
  test("qr trigger moves status to awaiting-qr", () => {
    whatsappStore.trigger.setQr({ qr: "QRDATA" });
    const snap = whatsappStore.getSnapshot().context;
    expect(snap.qr).toBe("QRDATA");
    expect(snap.status).toBe("awaiting-qr");
  });
  test("connected trigger clears qr pairing and error", () => {
    whatsappStore.trigger.setPairingCode({ code: "123" });
    whatsappStore.trigger.setConnected({ jid: "1@s.whatsapp.net" });
    const snap = whatsappStore.getSnapshot().context;
    expect(snap.status).toBe("connected");
    expect(snap.qr).toBeNull();
    expect(snap.pairingCode).toBeNull();
    expect(snap.error).toBeNull();
    expect(snap.jid).toBe("1@s.whatsapp.net");
  });
  test("error trigger records message", () => {
    whatsappStore.trigger.setError({ error: "boom" });
    const snap = whatsappStore.getSnapshot().context;
    expect(snap.status).toBe("error");
    expect(snap.error).toBe("boom");
  });
  test("log keeps only the last 100 entries", () => {
    const batch = Array.from({ length: 105 }, (_, i) => `cap-${i}`);
    for (const message of batch) whatsappStore.trigger.log({ message });
    const snap = whatsappStore.getSnapshot().context;
    expect(snap.log.length).toBeLessThanOrEqual(100);
    expect(snap.log.slice(-100).map((e) => e.message)).toEqual(batch.slice(-100));
    whatsappStore.trigger.setConnected({ jid: null });
    whatsappStore.trigger.setStatus({ status: "disconnected" });
  });
});

describe("actions validation", () => {
  test("sendWwpMessage rejects invalid phone without socket", async () => {
    await expect(sendWwpMessage("abc", "hi")).rejects.toThrow("Invalid phone number");
  });
  test("sendWwpMessage rejects empty message without socket", async () => {
    await expect(sendWwpMessage("+1555", "   ")).rejects.toThrow("empty");
  });
  test("whatsappFilePath nests name under whatsapp dir", () => {
    expect(whatsappFilePath("today").endsWith("/whatsapp/today.json")).toBe(true);
  });
  test("today tasks roundtrip in tmp system dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-chat-today-"));
    initLockDir(dir);
    const orig = options.app.systemDir;
    options.app.systemDir = dir;
    try {
      const added = await addTodayTask("buy milk");
      expect(added).toContain("buy milk");
      const raw = (await Bun.file(whatsappFilePath("today")).json()) as { items: { id: string; text: string }[] };
      expect(raw.items.map((t) => t.text)).toEqual(["buy milk"]);
      await expect(removeTodayTask("missing-id")).rejects.toThrow("missing-id");
      expect(await removeTodayTask(raw.items[0]!.id)).toContain("removed");
      const after = (await Bun.file(whatsappFilePath("today")).json()) as { items: unknown[] };
      expect(after.items).toEqual([]);
    } finally {
      options.app.systemDir = orig;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("wwp-tools schemas", () => {
  test("exposes two integration tools", () => {
    expect(wwpTools.map((t) => t.name).sort()).toEqual(["wwp-msg", "wwp-today"]);
    for (const tool of wwpTools) expect(tool.kind).toBe("integration");
  });
  test("wwp-msg params require phone and message strings", () => {
    const msg = wwpTools.find((t) => t.name === "wwp-msg")!;
    expect(msg.parameters.safeParse({ phone: "+1555", message: "hi" }).success).toBe(true);
    expect(msg.parameters.safeParse({ phone: "+1555" }).success).toBe(false);
    expect(msg.parameters.safeParse({ message: "hi" }).success).toBe(false);
    expect(msg.parameters.safeParse({ phone: 1, message: "hi" }).success).toBe(false);
  });
  test("wwp-today params require text", () => {
    const today = wwpTools.find((t) => t.name === "wwp-today")!;
    expect(today.parameters.safeParse({ text: "x" }).success).toBe(true);
    expect(today.parameters.safeParse({}).success).toBe(false);
  });
});
