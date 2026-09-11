import { describe, expect, test } from 'bun:test'
import { parseCommandLine } from '../../src/agent/commands/parse-command-line.ts'
import { bumpCatalog, catalogVersion } from '../../src/states/catalog-state.ts'

describe('catalog-state', () => {
  test('bumpCatalog increments the version', () => {
    const before = catalogVersion()
    bumpCatalog()
    expect(catalogVersion()).toBe(before + 1)
  })
})

describe('parseCommandLine /reload', () => {
  test('parses as a system command', () => {
    const parsed = parseCommandLine('/reload', [])
    expect(parsed?.kind).toBe('system')
    if (parsed?.kind === 'system') expect(parsed.command.name).toBe('reload')
  })
})
