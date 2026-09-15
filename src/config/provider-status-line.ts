export interface ProviderStatusLineItemBase {
  label: string
  value: string
}
export interface ProviderStatusLineHeaderItem extends ProviderStatusLineItemBase {
  type: 'header'
}
export interface ProviderStatusLineStepRawItem extends ProviderStatusLineItemBase {
  type: 'step-raw'
}
export interface ProviderStatusLineEndpointItem extends ProviderStatusLineItemBase {
  type: 'endpoint'
  endpoint: string
}
export type ProviderStatusLineItem = ProviderStatusLineHeaderItem | ProviderStatusLineStepRawItem | ProviderStatusLineEndpointItem
export interface ProviderStatusLine {
  items?: Array<ProviderStatusLineItem>
}
export interface ProviderStatusEntry {
  provider: string
  items: Array<ProviderStatusLineItem>
}
export const MAX_STATUS_LINE_ITEMS = 8
const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value)
const normalizeStatusLineItem = (item: unknown): ProviderStatusLineItem | undefined => {
  if (typeof item !== 'object' || item === null) return undefined
  const record = item as Record<string, unknown>
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  const value = typeof record.value === 'string' ? record.value.trim() : ''
  if (!label || !value) return undefined
  if (record.type === 'header') return { type: 'header', label, value }
  if (record.type === 'step-raw') return { type: 'step-raw', label, value }
  if (record.type === 'endpoint') {
    const endpoint = typeof record.endpoint === 'string' ? record.endpoint.trim() : ''
    if (!endpoint) return undefined
    if (!isHttpUrl(endpoint) && !endpoint.startsWith('/')) return undefined
    return { type: 'endpoint', label, value, endpoint }
  }
  return undefined
}
export const normalizeStatusLineItems = (items: unknown): Array<ProviderStatusLineItem> => {
  if (!Array.isArray(items)) return []
  const normalized: Array<ProviderStatusLineItem> = []
  for (const item of items) {
    const next = normalizeStatusLineItem(item)
    if (next) normalized.push(next)
    if (normalized.length >= MAX_STATUS_LINE_ITEMS) break
  }
  return normalized
}
export const normalizeStatusLine = (statusLine: unknown): ProviderStatusLine | undefined => {
  if (typeof statusLine !== 'object' || statusLine === null) return undefined
  const items = normalizeStatusLineItems((statusLine as { items?: unknown }).items)
  return items.length > 0 ? { items } : undefined
}
export const normalizeStatusLines = (statusLines: unknown): Array<ProviderStatusEntry> => {
  if (!Array.isArray(statusLines)) return []
  const normalized: Array<ProviderStatusEntry> = []
  for (const entry of statusLines) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const provider = typeof record.provider === 'string' ? record.provider.trim() : ''
    if (!provider) continue
    const items = normalizeStatusLineItems(record.items)
    if (items.length === 0) continue
    normalized.push({ provider, items })
  }
  return normalized
}
export const selectStatusLineItems = (statusLines: Array<ProviderStatusEntry> | undefined, providerId: string): Array<ProviderStatusLineItem> =>
  (statusLines ?? []).filter((entry) => entry.provider === providerId).flatMap((entry) => entry.items)
