import { describe, expect, test } from 'bun:test'
import { createReloadOptionsTool, createUpdateOptionsTool, UpdateOptionsArgsSchema } from '../../src/agent/tools/flow/options.ts'
import { baseFixtureOptions } from '../helpers/mock-options.ts'

describe('UpdateOptionsArgsSchema', () => {
  test('rejects a patch with a wrong-typed harness field', () => {
    expect(UpdateOptionsArgsSchema.safeParse({ patch: { harness: { maxAgents: 0 } } }).success).toBe(false)
  })
  test('accepts a minimal harness patch and unknown keys', () => {
    expect(UpdateOptionsArgsSchema.safeParse({ patch: { harness: { budgetLimitUsd: 5 } } }).success).toBe(true)
    expect(UpdateOptionsArgsSchema.safeParse({ patch: { harness: { whichever: 1 } } }).success).toBe(true)
  })
  test('accepts the documented MCP server patch (id from key, type inferred)', () => {
    expect(UpdateOptionsArgsSchema.safeParse({ patch: { mcp: { servers: { linear: { type: 'http', url: 'https://x/mcp' } } } } }).success).toBe(true)
  })
})

describe('update-options tool', () => {
  test('forwards the patch to updateSettings and reports success', async () => {
    let patch: unknown
    const tool = createUpdateOptionsTool({
      updateSettings: async (input) => {
        patch = input
        return baseFixtureOptions()
      },
    })
    const result = await tool.handler({ patch: { harness: { budgetLimitUsd: 5 } } })
    expect(patch).toEqual({ harness: { budgetLimitUsd: 5 } })
    expect(result.ok).toBe(true)
  })
  test('redacts provider api keys and headers from the returned options', async () => {
    const tool = createUpdateOptionsTool({
      updateSettings: async () =>
        baseFixtureOptions({
          providers: [{ id: 'p', name: 'P', type: 'openai', baseUrl: 'https://x', apiKey: 'secret-key', headers: { auth: 'bearer token' }, models: [] }],
        }),
    })
    const result = await tool.handler({ patch: {} })
    const providers = (result.options as { providers: Array<Record<string, unknown>> }).providers
    expect(providers[0]?.apiKey).toBe('[redacted]')
    expect(providers[0]?.headers).toBe('[redacted]')
  })
})

describe('reload-options tool', () => {
  test('invokes the reload and reports success', async () => {
    let called = 0
    const tool = createReloadOptionsTool({
      reloadOptions: async () => {
        called += 1
        return baseFixtureOptions()
      },
    })
    const result = await tool.handler()
    expect(called).toBe(1)
    expect(result.ok).toBe(true)
  })
})
