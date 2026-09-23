import pkg from '../../package.json' with { type: 'json' }

export type VersionKind = 'feature' | 'build'

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

let cached: string | undefined

export const parseVersion = (value: string): ParsedVersion => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match?.[1] || !match[2] || !match[3]) throw new Error(`Invalid version "${value}" — expected "<major>.<minor>.<patch>"`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export const bumpVersion = (current: string, kind: VersionKind): string => {
  const parsed = parseVersion(current)
  if (parsed.major !== 0) throw new Error(`Major version must stay 0 (got ${parsed.major}) — bump it manually in package.json`)
  if (kind === 'feature') return `0.${parsed.minor + 1}.0`
  return `0.${parsed.minor}.${parsed.patch + 1}`
}

export const getVersion = (): string => {
  if (cached) return cached
  const parsed = parseVersion(String((pkg as { version?: unknown }).version ?? ''))
  cached = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  return cached
}

export const formatConsoleTitle = (appName: string, sessionId?: string, sessionTitle?: string): string => {
  const segments = [appName, sessionId, sessionTitle].map((value) => value?.trim()).filter((value): value is string => typeof value === 'string' && value.length > 0)
  return segments.join(' | ')
}
