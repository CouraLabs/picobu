import type { ProviderStatusLineItem } from '@config/options.ts'

export interface ProviderStatusValue {
  label: string
  value: string
}

export interface ProviderStatusSources {
  headers?: Record<string, string>
  raw?: unknown
  endpoints?: Record<string, unknown>
}

export const getByPath = (value: unknown, path: string): unknown => {
  const segments = path.split('.').filter((segment) => segment.length > 0)
  let current: unknown = value
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export const formatStatusValue = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.length > 0 ? value : undefined
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

export const resolveHeaderValue = (headers: Record<string, string> | undefined, name: string): string | undefined => {
  if (!headers) return undefined
  const target = name.toLowerCase()
  for (const [key, entry] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return entry
  }
  return undefined
}

export const resolveStatusLineItem = (item: ProviderStatusLineItem, sources: ProviderStatusSources): ProviderStatusValue => {
  let found: unknown
  if (item.type === 'header') found = resolveHeaderValue(sources.headers, item.value)
  else if (item.type === 'step-raw') found = getByPath(sources.raw, item.value)
  else found = getByPath(sources.endpoints?.[item.label], item.value)
  return { label: item.label, value: formatStatusValue(found) ?? '-' }
}

export const resolveStatusLineValues = (items: Array<ProviderStatusLineItem> | undefined, sources: ProviderStatusSources): Array<ProviderStatusValue> =>
  (items ?? []).map((item) => resolveStatusLineItem(item, sources))
