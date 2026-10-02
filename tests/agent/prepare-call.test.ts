import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDoomLoopGuard } from '../../src/agent/loop/doom-loop.ts'
import { createPrepareCall, type PrepareCallDeps } from '../../src/agent/loop/prepare-call.ts'
import { options, type ProviderOptions } from '../../src/config/options.ts'

const fakeProvider: ProviderOptions = {
  id: 'test-cache',
  name: 'Test Cache',
  type: 'anthropic',
  baseUrl: 'https://example.test/v1',
  apiKey: 'fake-key',
  models: [{ id: 'test', name: 'Test', context: 128000, output: 64000 }],
}

beforeAll(() => {
  if (!options.providers.some((p) => p.id === fakeProvider.id)) options.providers.push(fakeProvider)
})

afterAll(() => {
  const index = options.providers.findIndex((p) => p.id === fakeProvider.id)
  if (index >= 0) options.providers.splice(index, 1)
})

const makeDeps = (): PrepareCallDeps => ({
  getConfig: () => ({ agentId: 'ask', modelKey: 'test-cache/test', thinking: 'none' }),
  toolSet: { getTools: () => [], getToolSet: () => ({}) },
  mcp: { tools: async () => ({}) } as never,
  buildSystem: async () => 'system',
  doomLoopGuard: createDoomLoopGuard(),
})

describe('createPrepareCall providerOptions', () => {
  const prepare = () => {
    const fn = createPrepareCall(makeDeps())
    if (!fn) throw new Error('createPrepareCall returned no prepareCall')
    return fn
  }

  test('nests cacheControl under the anthropic provider key', async () => {
    const result = await prepare()({ options: { sessionMode: 'chat' }, prompt: 'hi' } as never)
    expect(result?.providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } })
  })
})

describe('createPrepareCall active tools', () => {
  const run = async (agentId: string, tools: Record<string, unknown>, mcpTools: Record<string, unknown>) => {
    const fn = createPrepareCall({
      getConfig: () => ({ agentId, modelKey: 'test-cache/test', thinking: 'none' }),
      toolSet: { getTools: () => [], getToolSet: () => tools as never },
      mcp: { tools: async () => mcpTools } as never,
      buildSystem: async () => 'system',
      doomLoopGuard: createDoomLoopGuard(),
    })
    if (!fn) throw new Error('createPrepareCall returned no prepareCall')
    return fn({ options: { sessionMode: 'chat' }, prompt: 'hi' } as never)
  }

  test('keeps every mcp tool active for an agent that declares a tool subset', async () => {
    const result = await run('coder', { read: {}, write: {} }, { mcp_linear_create: {}, mcp_linear_list: {} })
    expect(result?.activeTools).toContain('read')
    expect(result?.activeTools).toContain('mcp_linear_create')
    expect(result?.activeTools).toContain('mcp_linear_list')
  })
})
