import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadApiKeyProviders, loadLocalPresetProviders } from '../../src/agent/model/registry.ts'
import { clearRuntimeApiKeyProviders } from '../../src/agent/model/runtime-providers.ts'
import { mockOptions, resetMockOptions } from '../helpers/mock-options.ts'

interface FetchCall {
  url: string
  headers: Record<string, string>
}

const ENV_KEYS = ['LITELLM_BASE_URL', 'LITELLM_API_KEY', 'OLLAMA_BASE_URL', 'OLLAMA_API_KEY', 'LMSTUDIO_BASE_URL', 'LMSTUDIO_API_KEY']

const originalFetch = globalThis.fetch

const modelsPayload = (ids: Array<string>): { ok: true; json: () => Promise<unknown> } => ({
  ok: true,
  json: async () => ({ data: ids.map((id) => ({ id, display_name: id.toUpperCase() })) }),
})

const stubFetch = (resolve: (url: string) => Promise<unknown> | unknown): Array<FetchCall> => {
  const calls: Array<FetchCall> = []
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), String(value)]))
    calls.push({ url, headers })
    return await resolve(url)
  }) as typeof fetch
  return calls
}

beforeEach(() => {
  resetMockOptions()
  clearRuntimeApiKeyProviders()
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  globalThis.fetch = originalFetch
  clearRuntimeApiKeyProviders()
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('loadLocalPresetProviders', () => {
  test('registers a reachable preset with its models', async () => {
    stubFetch((url) => (url.includes('11434') ? modelsPayload(['llama3']) : Promise.reject(new Error('offline'))))
    const providers = await loadLocalPresetProviders()
    const ollama = providers.find((provider) => provider.id === 'ollama')
    expect(ollama).toBeDefined()
    expect(ollama?.type).toBe('openai-compatible')
    expect(ollama?.npm).toBe('@ai-sdk/openai-compatible')
    expect(ollama?.baseUrl).toBe('http://localhost:11434/v1')
    expect(ollama?.models[0]?.id).toBe('llama3')
  })

  test('reads models from <baseUrl>/models', async () => {
    const calls = stubFetch((url) => (url.includes('4000') ? modelsPayload(['gpt-4o']) : Promise.reject(new Error('offline'))))
    await loadLocalPresetProviders()
    expect(calls.some((call) => call.url === 'http://localhost:4000/v1/models')).toBe(true)
  })

  test('omits apiKey when the env var is unset', async () => {
    stubFetch((url) => (url.includes('1234') ? modelsPayload(['qwen']) : Promise.reject(new Error('offline'))))
    const providers = await loadLocalPresetProviders()
    const lmstudio = providers.find((provider) => provider.id === 'lmstudio')
    expect(lmstudio).toBeDefined()
    expect('apiKey' in (lmstudio ?? {})).toBe(false)
  })

  test('uses the env api key and sends it as a bearer header', async () => {
    process.env.LITELLM_API_KEY = 'secret-key'
    const calls = stubFetch((url) => (url.includes('4000') ? modelsPayload(['gpt-4o']) : Promise.reject(new Error('offline'))))
    const providers = await loadLocalPresetProviders()
    expect(providers.find((provider) => provider.id === 'litellm')?.apiKey).toBe('secret-key')
    expect(calls.find((call) => call.url.includes('4000'))?.headers.authorization).toBe('Bearer secret-key')
  })

  test('sends no Authorization header for keyless presets', async () => {
    const calls = stubFetch((url) => (url.includes('11434') ? modelsPayload(['llama3']) : Promise.reject(new Error('offline'))))
    await loadLocalPresetProviders()
    const ollamaCall = calls.find((call) => call.url.includes('11434'))
    expect(ollamaCall).toBeDefined()
    expect(ollamaCall?.headers.authorization).toBeUndefined()
  })

  test('skips an unreachable preset', async () => {
    stubFetch((url) => (url.includes('11434') ? modelsPayload(['llama3']) : Promise.reject(new Error('offline'))))
    const providers = await loadLocalPresetProviders()
    expect(providers.map((provider) => provider.id)).toEqual(['ollama'])
  })

  test('skips a preset already present in options.providers', async () => {
    mockOptions.providers = [
      {
        id: 'litellm',
        name: 'Custom LiteLLM',
        type: 'openai-compatible',
        baseUrl: 'https://litellm.internal/v1',
        models: [{ id: 'm', name: 'M', context: 1, output: 1 }],
      },
    ]
    const calls = stubFetch((url) => (url.includes('11434') ? modelsPayload(['llama3']) : Promise.reject(new Error('offline'))))
    const providers = await loadLocalPresetProviders()
    expect(providers.map((provider) => provider.id)).toEqual(['ollama'])
    expect(calls.some((call) => call.url.includes('4000'))).toBe(false)
  })

  test('returns nothing when every preset is offline', async () => {
    stubFetch(() => Promise.reject(new Error('offline')))
    expect(await loadLocalPresetProviders()).toEqual([])
  })

  test('honours a base url env override', async () => {
    process.env.OLLAMA_BASE_URL = 'http://box:11434/v1'
    const calls = stubFetch(() => modelsPayload(['llama3']))
    const providers = await loadLocalPresetProviders()
    expect(providers.find((provider) => provider.id === 'ollama')?.baseUrl).toBe('http://box:11434/v1')
    expect(calls.some((call) => call.url === 'http://box:11434/v1/models')).toBe(true)
  })
})

describe('loadApiKeyProviders catalog guard', () => {
  const catalogEntry = (id: string, env: Array<string>) => ({
    id,
    name: id,
    env,
    npm: '@ai-sdk/openai-compatible',
    api: `https://api.${id}.test/v1`,
    models: { m1: { id: 'm1', name: 'M1', limit: { context: 1000, output: 100 } } },
  })

  test('does not autoload github-copilot from GITHUB_TOKEN', async () => {
    process.env.GITHUB_TOKEN = 'gh-token'
    try {
      const providers = await loadApiKeyProviders([catalogEntry('github-copilot', ['GITHUB_TOKEN'])] as never)
      expect(providers).toEqual([])
    } finally {
      delete process.env.GITHUB_TOKEN
    }
  })

  test('still autoloads other providers from their env var', async () => {
    process.env.PICOBU_TEST_CATALOG_KEY = 'k'
    try {
      const providers = await loadApiKeyProviders([catalogEntry('some-provider', ['PICOBU_TEST_CATALOG_KEY'])] as never)
      expect(providers.map((provider) => provider.id)).toEqual(['some-provider'])
      expect(providers[0]?.apiKey).toBe('env:PICOBU_TEST_CATALOG_KEY')
    } finally {
      delete process.env.PICOBU_TEST_CATALOG_KEY
    }
  })
})
