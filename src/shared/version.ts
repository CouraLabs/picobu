import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type VersionKind = 'feature' | 'build'

export type ParsedVersion = { major: number; minor: number; patch: number }

let cached: string | undefined

export const parseVersion = (value: string): ParsedVersion => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match?.[1] || !match[2] || !match[3]) throw new Error(`Invalid version "${value}" — expected "<major>.<minor>.<patch>"`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export const bumpVersion = (current: string, kind: VersionKind): string => {
  const parsed = parseVersion(current)
  if (parsed.major !== 1) throw new Error(`Major version must stay 1 (got ${parsed.major})`)
  if (kind === 'feature') return `1.${parsed.minor + 1}.0`
  return `1.${parsed.minor}.${parsed.patch + 1}`
}

export const getVersion = (): string => {
  if (cached) return cached
  const dir = dirname(fileURLToPath(import.meta.url))
  const raw = readFileSync(join(dir, '..', '..', 'package.json'), 'utf8')
  const parsed = parseVersion(String((JSON.parse(raw) as { version?: unknown }).version ?? ''))
  cached = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  return cached
}

export const formatConsoleTitle = (sessionTitle?: string): string => {
  const trimmed = sessionTitle?.trim()
  return trimmed ? `Picobu v${getVersion()} - ${trimmed}` : `Picobu v${getVersion()}`
}
