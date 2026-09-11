const MAX_BODY = 400

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null)

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const clip = (text: string): string => (text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…` : text)

const responseSummary = (body: string): string | null => {
  const text = body.trim()
  if (!text) return null
  try {
    const json = asRecord(JSON.parse(text))
    const nested = asRecord(json?.error)
    const summary = str(nested?.message) ?? str(json?.message) ?? str(json?.detail)
    if (summary) return clip(summary)
  } catch {}
  return clip(text)
}

const findApiRecord = (error: Error): Record<string, unknown> | null => {
  let current: unknown = error
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const record = asRecord(current) ?? {}
    if (typeof record.statusCode === 'number' || str(record.responseBody)) return record
    current = current.cause
  }
  return null
}

export interface ErrorReport {
  message: string
  detail: string | null
}

export const describeError = (error: unknown): ErrorReport => {
  if (!(error instanceof Error)) return { message: String(error), detail: null }
  const apiRecord = findApiRecord(error)
  const record = apiRecord ?? asRecord(error) ?? {}
  const header: Array<string> = []
  if (error.name && error.name !== 'Error') header.push(error.name)
  if (typeof record.statusCode === 'number') header.push(`HTTP ${record.statusCode}`)
  const message = header.length ? `${header.join(' · ')} · ${error.message}` : error.message
  const detail: Array<string> = []
  const url = str(record.url)
  if (url) detail.push(`url: ${url}`)
  const body = str(record.responseBody)
  if (body) {
    const summary = responseSummary(body)
    if (summary) detail.push(summary)
  }
  if (!apiRecord) {
    const cause = error.cause instanceof Error ? error.cause : null
    if (cause?.message && cause.message !== error.message) detail.push(`cause: ${cause.message}`)
  }
  return { message, detail: detail.length ? detail.join('\n') : null }
}

export const reportFromText = (text: string): ErrorReport => {
  const trimmed = text.trim()
  const lines = trimmed.split('\n')
  const message = lines[0]?.trim() || trimmed
  const detail = lines.slice(1).join('\n').trim()
  return { message, detail: detail || null }
}

export const withSessionId = (report: ErrorReport, sessionId: string | undefined): ErrorReport => {
  if (!sessionId) return report
  const line = `session: ${sessionId}`
  return { ...report, detail: report.detail ? `${report.detail}\n${line}` : line }
}
