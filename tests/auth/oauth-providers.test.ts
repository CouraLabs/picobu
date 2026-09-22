import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listModels, resolveModelRef } from '../../src/agent/model/resolver.ts'
import { listOAuthProviderEntries, listProviders } from '../../src/auth/oauth-providers.ts'
import { initAuthFilePath, resetAuthCache, setCredential } from '../../src/auth/store.ts'
import type { OAuthCredential } from '../../src/auth/types.ts'
import { options, type ProviderOptions } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'

let dir = ''
let prevProviders: Array<ProviderOptions> = []
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'picobu-oauth-providers-'))
  initLockDir(dir)
  initAuthFilePath(join(dir, 'auth.json'))
  prevProviders = options.providers
  options.providers = []
})
afterEach(async () => {
  options.providers = prevProviders
  resetAuthCache()
  await rm(dir, { recursive: true, force: true })
})

const copilotCredential = (ids: Array<string>): OAuthCredential => ({
  type: 'oauth',
  access: 'copilot-token',
  refresh: 'copilot-refresh',
  expires: Date.now() + 3600000,
  availableModelIds: ids,
})

const configuredCopilot = (): ProviderOptions => ({
  id: 'github-copilot',
  name: 'GitHub Copilot',
  type: 'openai-compatible',
  baseUrl: 'https://api.individual.githubcopilot.com',
  apiKey: 'auth:github-copilot',
  models: [{ id: 'm1', name: 'M1', context: 100, output: 10 }],
})

describe('listOAuthProviderEntries', () => {
  test('synthesizes copilot entry from stored credential ids', async () => {
    await setCredential('github-copilot', copilotCredential(['a', 'b']))
    const entries = listOAuthProviderEntries()
    expect(entries.map((entry) => entry.id)).toEqual(['github-copilot'])
    const entry = entries[0]
    expect(entry?.apiKey).toBe('auth:github-copilot')
    expect(entry?.type).toBe('openai-compatible')
    expect(entry?.models.map((model) => model.id)).toEqual(['a', 'b'])
  })
  test('returns live entry even when configured in options', async () => {
    await setCredential('github-copilot', copilotCredential(['a']))
    options.providers = [configuredCopilot()]
    expect(listOAuthProviderEntries().map((entry) => entry.id)).toEqual(['github-copilot'])
  })
  test('skips logged-out providers and credentials without ids', async () => {
    expect(listOAuthProviderEntries()).toEqual([])
    await setCredential('github-copilot', { ...copilotCredential(['a']), availableModelIds: [] })
    expect(listOAuthProviderEntries()).toEqual([])
  })
})

describe('listProviders', () => {
  test('unions configured providers with oauth entries', async () => {
    await setCredential('github-copilot', copilotCredential(['a']))
    options.providers = [configuredCopilot()].map((provider) => ({ ...provider, id: 'openai', name: 'OpenAI' }))
    expect(listProviders().map((provider) => provider.id)).toEqual(['openai', 'github-copilot'])
  })
  test('options models win over oauth live but oauth creds are used', async () => {
    await setCredential('github-copilot', copilotCredential(['live-a', 'live-b']))
    options.providers = [configuredCopilot()]
    const providers = listProviders()
    expect(providers.map((provider) => provider.id)).toEqual(['github-copilot'])
    expect(providers[0]?.models.map((model) => model.id)).toEqual(['m1'])
    expect(providers[0]?.apiKey).toBe('auth:github-copilot')
  })
  test('shows openai models once the credential carries ids', async () => {
    await setCredential('openai', {
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3600000,
      availableModelIds: ['gpt-5.5'],
      availableModels: [{ id: 'gpt-5.5', name: 'GPT-5.5', context: 400000, output: 128000, supports: ['text'] }],
    })
    expect(listProviders().map((provider) => provider.id)).toContain('openai')
    expect(listModels().map((model) => model.key)).toEqual(['openai/gpt-5.5'])
  })
  test('shows anthropic models once the credential carries ids', async () => {
    await setCredential('anthropic', {
      type: 'oauth',
      access: 'a',
      refresh: 'r',
      expires: Date.now() + 3600000,
      availableModelIds: ['claude-opus-4-6'],
      availableModels: [{ id: 'claude-opus-4-6', name: 'Claude Opus 4.6', context: 200000, output: 64000, supports: ['text'] }],
    })
    expect(listProviders().map((provider) => provider.id)).toContain('anthropic')
    expect(listModels().map((model) => model.key)).toEqual(['anthropic/claude-opus-4-6'])
  })
  test('hides unavailable models and drops emptied providers', async () => {
    options.providers = [
      {
        id: 'opencode-go',
        name: 'OpenCode Go',
        type: 'openai-compatible',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        models: [
          { id: 'ox-alpha-free', name: 'Ox', context: 0, output: 0, status: 'deprecated' },
          { id: 'alpha-foo', name: 'Alpha', context: 0, output: 0 },
          { id: 'glm-5.3-flash', name: 'Flash', context: 0, output: 0 },
        ],
      },
      {
        id: 'stale',
        name: 'Stale',
        type: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        models: [{ id: 'old', name: 'Old', context: 0, output: 0, status: 'deprecated' }],
      },
    ]
    expect(listProviders().map((provider) => provider.id)).toEqual(['opencode-go'])
    expect(listProviders()[0]?.models.map((model) => model.id)).toEqual(['glm-5.3-flash'])
  })
})

describe('listModels', () => {
  test('includes oauth models missing from options', async () => {
    await setCredential('github-copilot', copilotCredential(['a', 'b']))
    expect(listModels().map((model) => model.key)).toEqual(['github-copilot/a', 'github-copilot/b'])
  })
})

describe('resolveModelRef', () => {
  test('resolves oauth model missing from options', async () => {
    await setCredential('github-copilot', copilotCredential(['a']))
    const ref = resolveModelRef('github-copilot/a')
    expect(ref.provider.id).toBe('github-copilot')
    expect(ref.modelId).toBe('a')
  })
})
