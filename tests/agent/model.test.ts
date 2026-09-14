import { describe, expect, test } from 'bun:test'
import type { Provider as ModelsDevProvider } from '@opencode-ai/models'
import { modelsFromModelsDev } from '../../src/agent/model/catalog-models-dev.ts'
import { createModelInstance, headersForProvider, npmForModel } from '../../src/agent/model/resolver.ts'
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
  test('adds copilot IDE headers for github-copilot', () => {
    const headers = headersForProvider(baseProvider({ id: 'github-copilot', type: 'openai-compatible' }))
    expect(headers?.['Editor-Version']).toBe('vscode/1.107.0')
    expect(headers?.['Copilot-Integration-Id']).toBe('vscode-chat')
    expect(headers?.['User-Agent']).toContain('GitHubCopilotChat')
  })
  test('lets configured headers override copilot defaults', () => {
    const headers = headersForProvider(baseProvider({ id: 'github-copilot', type: 'openai-compatible', headers: { 'Editor-Version': 'custom/9' } }))
    expect(headers?.['Editor-Version']).toBe('custom/9')
    expect(headers?.['Copilot-Integration-Id']).toBe('vscode-chat')
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
})
