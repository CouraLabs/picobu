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

  test('does not emit a top-level cacheControl key', async () => {
    const result = await prepare()({ options: { sessionMode: 'chat' }, prompt: 'hi' } as never)
    expect(result?.providerOptions).not.toHaveProperty('cacheControl')
  })
})

const copilotProvider: ProviderOptions = {
  id: 'github-copilot',
  name: 'GitHub Copilot',
  type: 'openai-compatible',
  baseUrl: 'https://api.individual.githubcopilot.com',
  apiKey: 'fake-key',
  models: [
    { id: 'gpt-5', name: 'GPT-5', context: 128000, output: 64000, npm: '@ai-sdk/github-copilot', endpoint: 'responses' },
    { id: 'gpt-4o', name: 'GPT-4o', context: 128000, output: 64000, npm: '@ai-sdk/github-copilot', endpoint: 'chat' },
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', context: 128000, output: 64000, npm: '@ai-sdk/anthropic', endpoint: 'messages' },
  ],
}

describe('createPrepareCall copilot provider tools', () => {
  beforeAll(() => {
    if (!options.providers.some((p) => p.id === copilotProvider.id)) options.providers.push(copilotProvider)
  })
  afterAll(() => {
    const index = options.providers.findIndex((p) => p.id === copilotProvider.id)
    if (index >= 0) options.providers.splice(index, 1)
  })
  const deps = (modelKey: string): PrepareCallDeps => ({
    getConfig: () => ({ agentId: 'ask', modelKey, thinking: 'medium' }),
    toolSet: { getTools: () => [], getToolSet: () => ({ websearch: {} as never, read: {} as never }) },
    mcp: { tools: async () => ({}) } as never,
    buildSystem: async () => 'system',
    doomLoopGuard: createDoomLoopGuard(),
  })
  const run = async (modelKey: string) => {
    const fn = createPrepareCall(deps(modelKey))
    if (!fn) throw new Error('createPrepareCall returned no prepareCall')
    return fn({ options: { sessionMode: 'chat' }, prompt: 'hi' } as never)
  }
  test('preloads copilot tools and suspends picobu websearch on responses', async () => {
    const result = await run('github-copilot/gpt-5')
    const names = Object.keys(result?.tools ?? {})
    expect(names).toEqual(expect.arrayContaining(['web_search', 'code_interpreter', 'image_generation', 'file_search']))
    expect(names).not.toContain('websearch')
    expect(result?.activeTools).toEqual(expect.arrayContaining(['web_search', 'code_interpreter', 'image_generation', 'file_search']))
    expect(result?.activeTools).not.toContain('websearch')
  })
  test('keeps picobu websearch and omits copilot tools on the chat endpoint', async () => {
    const result = await run('github-copilot/gpt-4o')
    const names = Object.keys(result?.tools ?? {})
    expect(names).toContain('websearch')
    expect(names).not.toContain('web_search')
  })
  test('non-copilot providers keep picobu websearch', async () => {
    const result = await run('test-cache/test')
    const names = Object.keys(result?.tools ?? {})
    expect(names).toContain('websearch')
    expect(names).not.toContain('web_search')
  })
  test('forwards reasoning effort to copilot responses and guards placeholder thinking', async () => {
    const withThinking = async (thinking: string) => {
      const fn = createPrepareCall({
        ...deps('github-copilot/gpt-5'),
        getConfig: () => ({ agentId: 'ask', modelKey: 'github-copilot/gpt-5', thinking }),
      })
      if (!fn) throw new Error('createPrepareCall returned no prepareCall')
      return fn({ options: { sessionMode: 'chat' }, prompt: 'hi' } as never)
    }
    const medium = await withThinking('medium')
    expect(medium?.providerOptions).toHaveProperty('copilot', { reasoningEffort: 'medium' })
    const none = await withThinking('none')
    expect(none?.providerOptions).not.toHaveProperty('copilot')
    const providerDefault = await withThinking('provider-default')
    expect(providerDefault?.providerOptions).not.toHaveProperty('copilot')
  })
  test('disables tool streaming for copilot messages models', async () => {
    const fn = createPrepareCall(deps('github-copilot/claude-sonnet-4'))
    if (!fn) throw new Error('createPrepareCall returned no prepareCall')
    const result = await fn({ options: { sessionMode: 'chat' }, prompt: 'hi' } as never)
    expect(result?.providerOptions).toHaveProperty('anthropic', expect.objectContaining({ toolStreaming: false }))
  })
  test('does not preload copilot tools for NO_TOOLS agents', async () => {
    const fn = createPrepareCall({
      ...deps('github-copilot/gpt-5'),
      getConfig: () => ({ agentId: 'ask', modelKey: 'github-copilot/gpt-5', thinking: 'medium', agentOverride: { name: 'x', description: '', category: 'coding', tools: ['__none__'], prompt: '' } }),
    })
    if (!fn) throw new Error('createPrepareCall returned no prepareCall')
    const result = await fn({ options: { sessionMode: 'chat' }, prompt: 'hi' } as never)
    expect(Object.keys(result?.tools ?? {})).not.toContain('web_search')
    expect(result?.activeTools).toEqual([])
  })
})
