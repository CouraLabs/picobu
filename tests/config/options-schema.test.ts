import { describe, expect, test } from 'bun:test'
import { formatOptionsIssues, OptionsExternalSchema, OptionsPatchSchema } from '../../src/config/options-schema.ts'

describe('OptionsExternalSchema', () => {
  test('rejects a negative budgetLimitUsd with a path-qualified issue', () => {
    const result = OptionsExternalSchema.safeParse({ harness: { budgetLimitUsd: -1 } })
    expect(result.success).toBe(false)
    if (!result.success) expect(formatOptionsIssues(result.error)).toContain('harness.budgetLimitUsd')
  })

  test('accepts a harness.agent map alongside providers', () => {
    expect(OptionsExternalSchema.safeParse({ harness: { agent: { coder: 'flash' } }, providers: [] }).success).toBe(true)
  })

  test('accepts a legacy theme block', () => {
    expect(OptionsExternalSchema.safeParse({ theme: { key: 'picobu', variant: 'dark' } }).success).toBe(true)
  })

  test('keeps unknown top-level keys', () => {
    const result = OptionsExternalSchema.safeParse({ legacy: true })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.legacy).toBe(true)
  })

  test('rejects a provider without models', () => {
    const result = OptionsExternalSchema.safeParse({ providers: [{ id: 'p', name: 'P', type: 'openai', baseUrl: 'https://x' }] })
    expect(result.success).toBe(false)
  })

  test('accepts documented MCP servers where id is the key and type is inferred', () => {
    expect(OptionsExternalSchema.safeParse({ mcp: { servers: { linear: { type: 'http', url: 'x' } } } }).success).toBe(true)
    expect(OptionsExternalSchema.safeParse({ mcp: { servers: { fs: { command: 'npx', args: ['-y', 'fs-mcp'] } } } }).success).toBe(true)
  })
})

describe('OptionsPatchSchema', () => {
  test('accepts a minimal harness patch', () => {
    expect(OptionsPatchSchema.parse({ harness: { budgetLimitUsd: 5 } })).toEqual({ harness: { budgetLimitUsd: 5 } })
  })

  test('rejects a wrong-typed web port', () => {
    expect(OptionsPatchSchema.safeParse({ web: { port: 'x' } }).success).toBe(false)
  })

  test('keeps unknown harness keys', () => {
    const result = OptionsPatchSchema.safeParse({ harness: { whichever: 1 } })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.harness?.whichever).toBe(1)
  })
})
