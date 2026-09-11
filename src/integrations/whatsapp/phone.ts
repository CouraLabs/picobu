export const normalizePhone = (phone: unknown): string => (typeof phone === 'string' ? phone.replace(/[^0-9]/g, '') : '')

export const phoneToJid = (phone: string): string => `${normalizePhone(phone)}@s.whatsapp.net`

export const jidToPhone = (jid: string): string => normalizePhone(jid.split('@')[0]?.split(':')[0] ?? '')

export const normalizedAllowList = (allowed: ReadonlyArray<string>): Array<string> => Array.from(new Set(allowed.map(normalizePhone).filter(Boolean)))

export const isPhoneAllowed = (phone: string, allowedNumbers: ReadonlyArray<string>): boolean => normalizedAllowList(allowedNumbers).includes(normalizePhone(phone))
