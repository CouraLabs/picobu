const SECRET_FIELD_KEYS = new Set(['access_token', 'refresh_token', 'id_token', 'assertion', 'client_secret'])

const MAX_PLAIN_CHARS = 160

const previewValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'object') return `object(${Object.keys(value as Record<string, unknown>).join(',') || 'empty'})`
  return String(value).slice(0, MAX_PLAIN_CHARS)
}

export const describeTokenPayload = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return `non-object payload (type: ${typeof payload})`
  const entries = Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
    if (SECRET_FIELD_KEYS.has(key)) return `${key}: [redacted]`
    return `${key}: ${previewValue(value)}`
  })
  return entries.length > 0 ? `{ ${entries.join(', ')} }` : '{ empty object }'
}

export const redactTokenBody = (body: string): string => {
  try {
    return describeTokenPayload(JSON.parse(body))
  } catch {}
  return body.length > MAX_PLAIN_CHARS ? `${body.slice(0, MAX_PLAIN_CHARS)}…` : body
}
