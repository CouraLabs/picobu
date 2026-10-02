import { describe, expect, test } from 'bun:test'
import type { Provider as ModelsDevProvider } from '@opencode-ai/models'
import { modelsFromModelsDev } from '../../src/agent/model/catalog-models-dev.ts'
import { fetchModels, parseModelsResponse } from '../../src/agent/model/fetch-models.ts'
import {
  clearCatalogModelStatuses,
  filterAvailableModels,
  indexCatalogModelStatuses,
  isExperimentalModelsEnabled,
  isFreeModel,
  isModelAvailable,
  isModelStatusAvailable,
  isZenFullProvider,
  isZenModelIdAvailable,
  isZenProvider,
} from '../../src/agent/model/model-availability.ts'
import { createModelInstance, headersForProvider, normalizeProviderType, npmForModel, opencodeGoBaseUrl, resolveAuth, responsesEndpointUrl } from '../../src/agent/model/resolver.ts'
import type { ProviderOptions } from '../../src/config/options.ts'

const baseProvider = (overrides?: Partial<ProviderOptions>): ProviderOptions => ({
  id: 'openai',
  name: 'OpenAI',
  type: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  models: [],
  ...overrides,
})

describe('headersForProvider', () => {
  test('passes through configured headers for regular providers', () => {
    expect(headersForProvider(baseProvider())).toBeUndefined()
    expect(headersForProvider(baseProvider({ headers: { 'X-Custom': '1' } }))).toEqual({ 'X-Custom': '1' })
  })
  test('adds session and user-agent headers for opencode-go', () => {
    const provider = baseProvider({ id: 'opencode-go', name: 'OpenCode Go', type: 'openai-compatible', baseUrl: 'https://opencode.ai/zen/go/v1' })
    const headers = headersForProvider(provider, { sessionId: 'sess-123' })
    expect(headers?.['x-opencode-session']).toBe('sess-123')
    expect(headers?.['User-Agent']).toContain('picobu/')
  })
  test('falls back to a stable session id when none is given', () => {
    const provider = baseProvider({ id: 'opencode-go', name: 'OpenCode Go', type: 'openai-compatible', baseUrl: 'https://opencode.ai/zen/go/v1' })
    expect(headersForProvider(provider)?.['x-opencode-session']).toBe('picobu-shared')
  })
  test('keeps a configured opencode-go session id', () => {
    const provider = baseProvider({ id: 'opencode-go', name: 'OpenCode Go', type: 'openai-compatible', baseUrl: 'https://opencode.ai/zen/go/v1', headers: { 'x-opencode-session': 'custom' } })
    expect(headersForProvider(provider)?.['x-opencode-session']).toBe('custom')
  })
})

describe('npmForModel', () => {
  const goProvider = (overrides?: Partial<ProviderOptions>): ProviderOptions => ({
    id: 'opencode-go',
    name: 'OpenCode Go',
    type: 'openai-compatible',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    npm: '@ai-sdk/openai-compatible',
    models: [],
    ...overrides,
  })
  test('prefers stored per-model npm', () => {
    expect(npmForModel(goProvider(), { id: 'muse-spark-1.3-contributor', npm: '@ai-sdk/openai' })).toBe('@ai-sdk/openai')
  })
  test('falls back to the responses API for known go responses models', () => {
    expect(npmForModel(goProvider(), { id: 'muse-spark-1.3-contributor' })).toBe('@ai-sdk/openai')
    expect(npmForModel(goProvider(), { id: 'gpt-5.6-luna' })).toBe('@ai-sdk/openai')
  })
  test('uses provider npm for regular go models', () => {
    expect(npmForModel(goProvider(), { id: 'glm-5.3-flash' })).toBe('@ai-sdk/openai-compatible')
  })
  test('routes qwen and minimax go models without catalog npm to messages', () => {
    expect(npmForModel(goProvider(), { id: 'qwen3.7-max' })).toBe('@ai-sdk/anthropic')
    expect(npmForModel(goProvider(), { id: 'qwen3.8-max' })).toBe('@ai-sdk/anthropic')
    expect(npmForModel(goProvider(), { id: 'qwen3.6-plus' })).toBe('@ai-sdk/anthropic')
    expect(npmForModel(goProvider(), { id: 'minimax-m2.5', npm: '' })).toBe('@ai-sdk/anthropic')
  })
  test('keeps family routing scoped to go providers', () => {
    const other = baseProvider({ id: 'openai', npm: '@ai-sdk/openai' })
    expect(npmForModel(other, { id: 'qwen3.7-max' })).toBe('@ai-sdk/openai')
  })
})

describe('opencodeGoBaseUrl', () => {
  test('leaves the versioned root untouched', () => {
    expect(opencodeGoBaseUrl('https://opencode.ai/zen/go/v1')).toBe('https://opencode.ai/zen/go/v1')
  })
  test('strips pasted endpoint suffixes back to the root', () => {
    expect(opencodeGoBaseUrl('https://opencode.ai/zen/go/v1/chat/completions')).toBe('https://opencode.ai/zen/go/v1')
    expect(opencodeGoBaseUrl('https://opencode.ai/zen/go/v1/responses')).toBe('https://opencode.ai/zen/go/v1')
    expect(opencodeGoBaseUrl('https://opencode.ai/zen/go/v1/messages')).toBe('https://opencode.ai/zen/go/v1')
    expect(opencodeGoBaseUrl('https://opencode.ai/zen/go/v1/messages/')).toBe('https://opencode.ai/zen/go/v1')
  })
  test('leaves foreign urls and missing values alone', () => {
    expect(opencodeGoBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
    expect(opencodeGoBaseUrl(undefined)).toBeUndefined()
  })
})

describe('createModelInstance', () => {
  const goProvider = (): ProviderOptions => ({
    id: 'opencode-go',
    name: 'OpenCode Go',
    type: 'openai-compatible',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKey: 'test-key',
    npm: '@ai-sdk/openai-compatible',
    models: [],
  })
  test('routes go responses models to the responses API', () => {
    const model = createModelInstance(goProvider(), 'muse-spark-1.3-contributor')
    expect(String(model.provider)).toContain('responses')
  })
  test('keeps regular go models on chat completions', () => {
    const model = createModelInstance(goProvider(), 'glm-5.3-flash')
    expect(String(model.provider)).toContain('chat')
  })
  test('routes go messages models to the messages API', () => {
    const model = createModelInstance(goProvider(), 'qwen3.7-max')
    expect(String(model.provider)).toContain('messages')
  })
  test('normalizes a pasted endpoint base url back to the root', () => {
    const provider: ProviderOptions = { ...goProvider(), baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions' }
    const model = createModelInstance(provider, 'glm-5.3-flash')
    expect(String(model.provider)).toContain('chat')
  })
})

describe('local and compatible endpoints', () => {
  test('normalizeProviderType maps the compatible aliases', () => {
    expect(normalizeProviderType('anthropic-compatible')).toBe('anthropic')
    expect(normalizeProviderType('openai-responses-compatible')).toBe('openai-responses')
    expect(normalizeProviderType('openai')).toBe('openai')
    expect(normalizeProviderType('openai-compatible')).toBe('openai-compatible')
  })

  test('responsesEndpointUrl appends /responses only when missing', () => {
    expect(responsesEndpointUrl('http://h/v1')).toBe('http://h/v1/responses')
    expect(responsesEndpointUrl('http://h/v1/')).toBe('http://h/v1/responses')
    expect(responsesEndpointUrl('http://h/v1/responses')).toBe('http://h/v1/responses')
    expect(responsesEndpointUrl('')).toBe('')
    expect(responsesEndpointUrl(undefined)).toBe('')
  })

  test('builds a keyless openai-compatible model through the openai-compatible adapter', () => {
    const provider: ProviderOptions = { id: 'ollama', name: 'Ollama', type: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', models: [] }
    expect(resolveAuth(provider).apiKey).toBeUndefined()
    const model = createModelInstance(provider, 'llama3')
    expect(model.specificationVersion).toBe('v4')
    expect(String(model.provider)).toBe('Ollama.chat')
  })

  test('resolves an env: api key to its value', () => {
    process.env.PICOBU_TEST_LOCAL_KEY = 'from-env'
    expect(resolveAuth({ id: 'litellm', name: 'LiteLLM', type: 'openai-compatible', baseUrl: 'http://localhost:4000/v1', apiKey: 'env:PICOBU_TEST_LOCAL_KEY', models: [] }).apiKey).toBe('from-env')
    delete process.env.PICOBU_TEST_LOCAL_KEY
  })

  test('builds an anthropic-compatible model from a custom base url', () => {
    const provider: ProviderOptions = { id: 'local-claude', name: 'Local Claude', type: 'anthropic-compatible', baseUrl: 'http://localhost:9000', models: [] }
    const model = createModelInstance(provider, 'claude-sonnet-4')
    expect(String(model.provider)).toContain('anthropic')
  })

  test('builds an openai-responses-compatible model from a base url', () => {
    const provider: ProviderOptions = { id: 'local-responses', name: 'Local Responses', type: 'openai-responses-compatible', baseUrl: 'http://localhost:8000/v1', models: [] }
    expect(() => createModelInstance(provider, 'gpt-5')).not.toThrow()
    expect(String(createModelInstance(provider, 'gpt-5').provider)).toContain('responses')
  })

  test('routes anthropic-compatible through npmForProviderType', () => {
    expect(npmForModel({ id: 'local', name: 'Local', type: 'anthropic-compatible', baseUrl: 'http://localhost:9000', models: [] })).toBe('@ai-sdk/anthropic')
  })
})

describe('fetchModels', () => {
  const originalFetch = globalThis.fetch
  let capturedHeaders: Record<string, string> = {}

  const stub = () => {
    globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ data: [{ id: 'llama3' }] }) } as unknown as Response
    }) as typeof fetch
  }

  test('omits Authorization without a key and sends it with one', async () => {
    try {
      stub()
      await fetchModels('http://localhost:11434/v1/models', undefined)
      expect(Object.keys(capturedHeaders).map((key) => key.toLowerCase())).not.toContain('authorization')
      await fetchModels('http://localhost:11434/v1/models', 'k')
      expect(capturedHeaders.Authorization).toBe('Bearer k')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('modelsFromModelsDev', () => {
  test('preserves per-model npm overrides', () => {
    const dev = {
      id: 'opencode-go',
      models: {
        'muse-spark-1.3-contributor': { id: 'muse-spark-1.3-contributor', name: 'Muse', limit: {}, provider: { npm: '@ai-sdk/openai' } },
        'glm-5.3-flash': { id: 'glm-5.3-flash', name: 'Flash', limit: {} },
      },
    } as unknown as ModelsDevProvider
    const models = modelsFromModelsDev(dev)
    expect(models.find((m) => m.id === 'muse-spark-1.3-contributor')?.npm).toBe('@ai-sdk/openai')
    expect(models.find((m) => m.id === 'glm-5.3-flash')?.npm).toBeUndefined()
  })
  test('drops deprecated models like ox-alpha-free', () => {
    const dev = {
      id: 'opencode-go',
      api: 'https://opencode.ai/zen/go/v1',
      models: {
        'ox-alpha-free': { id: 'ox-alpha-free', name: 'Ox', limit: {}, status: 'deprecated' },
        'glm-5.3-flash': { id: 'glm-5.3-flash', name: 'Flash', limit: {} },
      },
    } as unknown as ModelsDevProvider
    const models = modelsFromModelsDev(dev)
    expect(models.map((m) => m.id)).toEqual(['glm-5.3-flash'])
  })
  test('drops free models on zen full providers', () => {
    const dev = {
      id: 'opencode',
      api: 'https://opencode.ai/zen/v1',
      models: {
        'big-pickle': { id: 'big-pickle', name: 'Big', limit: {}, cost: { input: 0, output: 0 } },
        'claude-opus-4-6': { id: 'claude-opus-4-6', name: 'Opus', limit: {}, cost: { input: 5, output: 20 } },
      },
    } as unknown as ModelsDevProvider
    expect(modelsFromModelsDev(dev).map((m) => m.id)).toEqual(['claude-opus-4-6'])
  })
  test('preserves status and hides alpha unless experimental', () => {
    const dev = {
      id: 'openai',
      models: {
        'exp-model': { id: 'exp-model', name: 'Exp', limit: {}, status: 'alpha' },
        'std-model': { id: 'std-model', name: 'Std', limit: {}, status: 'active' },
      },
    } as unknown as ModelsDevProvider
    expect(modelsFromModelsDev(dev).map((m) => m.id)).toEqual(['std-model'])
    const experimental = modelsFromModelsDev(dev, { experimental: true })
    expect(experimental.map((m) => m.id).sort()).toEqual(['exp-model', 'std-model'])
    expect(experimental.find((m) => m.id === 'exp-model')?.status).toBe('alpha')
  })
})

describe('model availability', () => {
  test('reads the experimental flag from the environment', () => {
    const prev = process.env.PICOBU_EXPERIMENTAL_MODELS
    try {
      delete process.env.PICOBU_EXPERIMENTAL_MODELS
      expect(isExperimentalModelsEnabled()).toBe(false)
      process.env.PICOBU_EXPERIMENTAL_MODELS = '1'
      expect(isExperimentalModelsEnabled()).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.PICOBU_EXPERIMENTAL_MODELS
      else process.env.PICOBU_EXPERIMENTAL_MODELS = prev
    }
  })
  test('hides deprecated always and alpha without experimental', () => {
    expect(isModelStatusAvailable('deprecated', false)).toBe(false)
    expect(isModelStatusAvailable('deprecated', true)).toBe(false)
    expect(isModelStatusAvailable('alpha', false)).toBe(false)
    expect(isModelStatusAvailable('alpha', true)).toBe(true)
    expect(isModelStatusAvailable('beta', false)).toBe(true)
    expect(isModelStatusAvailable('active', false)).toBe(true)
    expect(isModelStatusAvailable(undefined, false)).toBe(true)
  })
  test('detects zen providers by id or base url', () => {
    expect(isZenProvider({ id: 'opencode-go', baseUrl: '' })).toBe(true)
    expect(isZenProvider({ id: 'opencode', baseUrl: '' })).toBe(true)
    expect(isZenProvider({ id: 'custom', baseUrl: 'https://opencode.ai/zen/go/v1' })).toBe(true)
    expect(isZenProvider({ id: 'custom', baseUrl: 'https://opencode.ai/zen/v1' })).toBe(true)
    expect(isZenProvider({ id: 'openai', baseUrl: 'https://api.openai.com/v1' })).toBe(false)
  })
  test('hides zen server ids that chat rejects', () => {
    expect(isZenModelIdAvailable('alpha-foo')).toBe(false)
    expect(isZenModelIdAvailable('foo:global')).toBe(false)
    expect(isZenModelIdAvailable('claude-3-5-haiku')).toBe(false)
    expect(isZenModelIdAvailable('glm-5.3-flash')).toBe(true)
    expect(isZenModelIdAvailable('ox-alpha-free')).toBe(true)
  })
  test('scopes zen id filtering to zen providers', () => {
    const zen = { id: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' }
    const other = { id: 'openai', baseUrl: 'https://api.openai.com/v1' }
    expect(isModelAvailable(zen, { id: 'alpha-foo', status: undefined }, false)).toBe(false)
    expect(isModelAvailable(other, { id: 'alpha-foo', status: undefined }, false)).toBe(true)
    expect(isModelAvailable(zen, { id: 'glm-5.3-flash', status: undefined }, false)).toBe(true)
  })
  test('hides catalog-deprecated ids even without stored status', () => {
    const provider = { id: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' }
    const models = [{ id: 'ox-alpha-free', name: 'Ox', context: 0, output: 0 }]
    try {
      indexCatalogModelStatuses([{ id: 'opencode-go', models: { 'ox-alpha-free': { id: 'ox-alpha-free', status: 'deprecated' } } }])
      expect(filterAvailableModels(provider, models, false).map((m) => m.id)).toEqual([])
    } finally {
      clearCatalogModelStatuses()
    }
  })
  test('detects zen full providers excluding go', () => {
    expect(isZenFullProvider({ id: 'opencode', baseUrl: '' })).toBe(true)
    expect(isZenFullProvider({ id: 'opencode-zen', baseUrl: '' })).toBe(true)
    expect(isZenFullProvider({ id: 'custom', baseUrl: 'https://opencode.ai/zen/v1' })).toBe(true)
    expect(isZenFullProvider({ id: 'opencode-go', baseUrl: '' })).toBe(false)
    expect(isZenFullProvider({ id: 'custom', baseUrl: 'https://opencode.ai/zen/go/v1' })).toBe(false)
    expect(isZenFullProvider({ id: 'openai', baseUrl: 'https://api.openai.com/v1' })).toBe(false)
  })
  test('detects free models by zero input and output cost', () => {
    expect(isFreeModel('opencode', { id: 'a', billing: { input: 0, output: 0 } })).toBe(true)
    expect(isFreeModel('opencode', { id: 'a', billing: { input: 1, output: 2 } })).toBe(false)
    expect(isFreeModel('opencode', { id: 'a', billing: { input: 0, output: 1 } })).toBe(false)
    expect(isFreeModel('opencode', { id: 'a' })).toBe(false)
  })
  test('hides free models on zen full but keeps them elsewhere', () => {
    const zen = { id: 'opencode', baseUrl: 'https://opencode.ai/zen/v1' }
    const go = { id: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' }
    const other = { id: 'openai', baseUrl: 'https://api.openai.com/v1' }
    const free = { id: 'big-pickle', status: undefined, billing: { input: 0, output: 0 } }
    const paid = { id: 'claude-opus-4-6', status: undefined, billing: { input: 5, output: 20 } }
    expect(isModelAvailable(zen, free, false)).toBe(false)
    expect(isModelAvailable(zen, paid, false)).toBe(true)
    expect(isModelAvailable(go, free, false)).toBe(true)
    expect(isModelAvailable(other, free, false)).toBe(true)
  })
  test('hides free zen models via catalog cost without stored billing', () => {
    const provider = { id: 'opencode', baseUrl: 'https://opencode.ai/zen/v1' }
    const models = [
      { id: 'big-pickle', name: 'B', context: 0, output: 0 },
      { id: 'claude-opus-4-6', name: 'C', context: 0, output: 0 },
    ]
    try {
      indexCatalogModelStatuses([
        { id: 'opencode', models: { 'big-pickle': { id: 'big-pickle', cost: { input: 0, output: 0 } }, 'claude-opus-4-6': { id: 'claude-opus-4-6', cost: { input: 5, output: 20 } } } },
      ])
      expect(filterAvailableModels(provider, models, false).map((m) => m.id)).toEqual(['claude-opus-4-6'])
    } finally {
      clearCatalogModelStatuses()
    }
  })
})

describe('parseModelsResponse filtering', () => {
  test('drops zen server ids that chat rejects', () => {
    const models = parseModelsResponse({ data: [{ id: 'alpha-foo' }, { id: 'foo:global' }, { id: 'glm-5.3-flash' }] }, { id: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' })
    expect(models.map((m) => m.id)).toEqual(['glm-5.3-flash'])
  })
  test('leaves other providers untouched without a provider ref', () => {
    const models = parseModelsResponse({ data: [{ id: 'alpha-foo' }] })
    expect(models.map((m) => m.id)).toEqual(['alpha-foo'])
  })
})

describe('keyless providers never use an ambient api key', () => {
  test('anthropic and openai compatible endpoints do not forward ANTHROPIC_API_KEY/OPENAI_API_KEY', async () => {
    const seen: Array<Record<string, string>> = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        seen.push(Object.fromEntries(request.headers.entries()))
        return Response.json({
          id: 'x',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      },
    })
    const sentinel = 'sk-AMBIENT-SENTINEL-DO-NOT-SEND'
    process.env.ANTHROPIC_API_KEY = sentinel
    process.env.OPENAI_API_KEY = sentinel
    try {
      for (const type of ['anthropic', 'anthropic-compatible', 'openai']) {
        const provider: ProviderOptions = { id: `local-${type}`, name: type, type, baseUrl: `http://127.0.0.1:${server.port}/v1`, models: [] }
        const model = createModelInstance(provider, 'test-model')
        await Promise.resolve(model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })).then(
          () => undefined,
          () => undefined,
        )
      }
      expect(seen.length).toBeGreaterThanOrEqual(3)
      for (const headers of seen) {
        const values = Object.values(headers).join(' ')
        expect(values).not.toContain(sentinel)
      }
    } finally {
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAI_API_KEY
      server.stop(true)
    }
  })
})
