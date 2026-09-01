/** Phone-number normalization for the WhatsApp allow-list and JIDs. */

/** Bare-digit form: strips `+`, spaces, dashes, parens. */
export const normalizePhone = (phone: string): string => phone.replace(/[^0-9]/g, "");

/** Remote JID for a phone number: `<digits>@s.whatsapp.net`. */
export const phoneToJid = (phone: string): string => `${normalizePhone(phone)}@s.whatsapp.net`;

/**
 * Bare phone number from a JID. Strips the `:device` suffix (own-JIDs are
 * `<digits>:<deviceId>@s.whatsapp.net`) and the agent domain.
 */
export const jidToPhone = (jid: string): string =>
  normalizePhone(jid.split("@")[0]?.split(":")[0] ?? "");

/** Normalized copy of an allow-list (digits only, deduped). */
export const normalizedAllowList = (allowed: readonly string[]): string[] =>
  Array.from(new Set(allowed.map(normalizePhone).filter(Boolean)));

/** True when `phone` is on the allow-list (empty list = nobody). */
export const isPhoneAllowed = (phone: string, allowedNumbers: readonly string[]): boolean =>
  normalizedAllowList(allowedNumbers).includes(normalizePhone(phone));

