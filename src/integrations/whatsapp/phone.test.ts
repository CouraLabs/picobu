import { describe, expect, test } from "bun:test";
import {
  isPhoneAllowed,
  jidToPhone,
  normalizePhone,
  normalizedAllowList,
  phoneToJid,
} from "./phone";

describe("phone normalization", () => {
  test("normalizePhone strips non-digits", () => {
    expect(normalizePhone("+55 (11) 99999-8888")).toBe("5511999998888");
    expect(normalizePhone("1555-123-4567")).toBe("15551234567");
  });

test("phoneToJid / jidToPhone round-trip", () => {
  expect(phoneToJid("15551234567")).toBe("15551234567@s.whatsapp.net");
  expect(jidToPhone("15551234567@s.whatsapp.net")).toBe("15551234567");
  // Own JIDs carry a `:device` suffix — it must not leak into the number.
  expect(jidToPhone("15551234567:12@s.whatsapp.net")).toBe("15551234567");
  // LID JIDs (WhatsApp's identity migration) yield the LID digits, not a phone.
  expect(jidToPhone("209175836154921@lid")).toBe("209175836154921");
});

  test("normalizedAllowList dedupes and strips formatting", () => {
    expect(normalizedAllowList(["+1 555-123-4567", "15551234567", ""])).toEqual(["15551234567"]);
  });

  test("isPhoneAllowed matches normalized numbers; empty list allows nobody", () => {
    expect(isPhoneAllowed("+1 (555) 123-4567", ["15551234567"])).toBe(true);
    expect(isPhoneAllowed("15551234567", [])).toBe(false);
    expect(isPhoneAllowed("1999", ["15551234567"])).toBe(false);
  });
});
