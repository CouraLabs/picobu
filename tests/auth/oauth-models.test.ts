import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Provider as ModelsDevProvider } from '@opencode-ai/models'
import {
  ANTHROPIC_MODELS_URL,
  applyOpenAIOAuthOverrides,
  bareOAuthModels,
  buildOAuthModels,
  fetchLiveOAuthModelIds,
  filterOpenAIOAuthModelIds,
  filterOpenAIOAuthModels,
  isOpenAIOAuthModelId,
  OPENAI_MODELS_URL,
  oauthProviderHasLiveModels,
  parseModelIdsPayload,
  withPreservedModels,
} from '../../src/auth/oauth-models.ts'
import { oauthProviderCatalogSupported, populateOAuthModels } from '../../src/auth/register.ts'
import { getCredential, initAuthFilePath, resetAuthCache, setCredential } from '../../src/auth/store.ts'
import type { OAuthAuth, OAuthCredential } from '../../src/auth/types.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const catalogFixture = (): ModelsDevProvider =>
  ({
    id: 'openai',
    models: {
      'gpt-5.5': { id: 'gpt-5.5', name: 'GPT-5.5', limit: { context: 400000, output: 128000 }, cost: { input: 1, output: 2 } },
      'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', limit: { context: 128000, output: 16384 } },
      'claude-opus-4-6': { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', limit: { context: 200000, output: 64000 } },
      'old-model': { id: 'old-model', name: 'Old', limit: {}, status: 'deprecated' },
    },
  }) as unknown as ModelsDevProvider

const credential = (overrides?: Partial<OAuthCredential>): OAuthCredential => ({ type: 'oauth', access: 'access', refresh: 'refresh', expires: Date.now() + 3600000, ...overrides })

const stubFetch = (mock: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void => {
  globalThis.fetch = Object.assign(mock, { preconnect: realFetch.preconnect }) as unknown as typeof fetch
}

describe('isOpenAIOAuthModelId', () => {
  test('allows the explicit allowlist', () => {
    for (const id of ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark', 'gpt-6-sol', 'gpt-6-luna']) expect(isOpenAIOAuthModelId(id)).toBe(true)
  })
  test('passes newer gpt versions by rule', () => {
    expect(isOpenAIOAuthModelId('gpt-6.1')).toBe(true)
    expect(isOpenAIOAuthModelId('gpt-7')).toBe(true)
  })
  test('drops disallowed, gpt-5.6 and older or non-gpt ids', () => {
    for (const id of ['gpt-5.5-pro', 'gpt-5.6', 'gpt-5.3', 'gpt-5', 'gpt-4o', 'o3', '']) expect(isOpenAIOAuthModelId(id)).toBe(false)
  })
})

describe('filterOpenAIOAuthModelIds', () => {
  test('keeps passing ids and drops the rest', () => {
    expect(filterOpenAIOAuthModelIds(['gpt-4o', 'gpt-5.5', 'gpt-5.6', 'gpt-6-sol'])).toEqual(['gpt-5.5', 'gpt-6-sol'])
  })
  test('returns the original list when everything would be filtered', () => {
    expect(filterOpenAIOAuthModelIds(['gpt-4o', 'o3'])).toEqual(['gpt-4o', 'o3'])
  })
  test('handles empty input', () => {
    expect(filterOpenAIOAuthModelIds([])).toEqual([])
  })
})

describe('filterOpenAIOAuthModels', () => {
  const model = (id: string) => ({ id, name: id, context: 0, output: 0, supports: ['text'] })
  test('filters by id', () => {
    expect(filterOpenAIOAuthModels([model('gpt-4o'), model('gpt-5.5')]).map((m) => m.id)).toEqual(['gpt-5.5'])
  })
  test('keeps originals when everything would be filtered', () => {
    expect(filterOpenAIOAuthModels([model('gpt-4o')]).map((m) => m.id)).toEqual(['gpt-4o'])
  })
})

describe('bareOAuthModels', () => {
  test('maps ids to text-only models', () => {
    expect(bareOAuthModels(['a'])).toEqual([{ id: 'a', name: 'a', context: 0, output: 0, supports: ['text'] }])
  })
})

describe('buildOAuthModels', () => {
  test('enriches live ids from the catalog', () => {
    const built = buildOAuthModels('openai', ['gpt-5.5'], catalogFixture())
    expect(built.modelIds).toEqual(['gpt-5.5'])
    expect(built.models[0]?.name).toBe('GPT-5.5')
    expect(built.models[0]?.context).toBe(400000)
  })
  test('falls back to bare models without a catalog', () => {
    const built = buildOAuthModels('openai', ['gpt-5.5'], undefined)
    expect(built.modelIds).toEqual(['gpt-5.5'])
    expect(built.models[0]?.context).toBe(400_000)
    expect(built.models[0]?.billing).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })
  test('uses the full catalog when no live ids exist', () => {
    const built = buildOAuthModels('anthropic', [], catalogFixture())
    expect(built.modelIds).toContain('claude-opus-4-6')
    expect(built.modelIds).not.toContain('old-model')
  })
  test('returns nothing without live ids or a catalog', () => {
    expect(buildOAuthModels('anthropic', [], undefined)).toEqual({ modelIds: [], models: [] })
  })
  test('applies the openai subscription filter', () => {
    expect(buildOAuthModels('openai', ['gpt-4o', 'gpt-5.5'], catalogFixture()).modelIds).toEqual(['gpt-5.5'])
    expect(buildOAuthModels('openai', ['gpt-4o'], catalogFixture()).modelIds).toEqual(['gpt-4o'])
  })
  test('leaves anthropic ids unfiltered', () => {
    expect(buildOAuthModels('anthropic', ['claude-opus-4-6', 'mystery'], catalogFixture()).modelIds).toEqual(['claude-opus-4-6', 'mystery'])
  })
})

describe('applyOpenAIOAuthOverrides', () => {
  test('zeroes billing and rewrites context for gpt-5.5 and gpt-5.6 ids', () => {
    const [model] = applyOpenAIOAuthOverrides([{ id: 'gpt-5.6-sol-fast', name: 'GPT-5.6 Sol Fast', context: 1050000, output: 64000, billing: { input: 8, output: 40 } }])
    expect(model?.billing).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    expect(model?.context).toBe(400_000)
    expect(model?.output).toBe(128_000)
  })
  test('zeroes billing but keeps the context of other models', () => {
    const [model] = applyOpenAIOAuthOverrides([{ id: 'gpt-5.4', name: 'GPT-5.4', context: 1050000, output: 128000, billing: { input: 5, output: 30 } }])
    expect(model?.context).toBe(1050000)
    expect(model?.billing).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })
})

describe('openai oauth overrides end to end', () => {
  test('keeps the allowlist, zeroes billing and rewrites gpt-5.5/5.6 limits', () => {
    const built = buildOAuthModels('openai', ['gpt-5.5', 'gpt-5.4', 'gpt-4o'], catalogFixture())
    expect(built.modelIds).toEqual(['gpt-5.5', 'gpt-5.4'])
    const fiveFive = built.models.find((model) => model.id === 'gpt-5.5')
    expect(fiveFive?.context).toBe(400_000)
    expect(fiveFive?.output).toBe(128_000)
    expect(fiveFive?.billing).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    const fiveFour = built.models.find((model) => model.id === 'gpt-5.4')
    expect(fiveFour?.billing).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  })
  test('leaves anthropic models untouched', () => {
    const built = buildOAuthModels('anthropic', ['claude-opus-4-6'], catalogFixture())
    expect(built.modelIds).toEqual(['claude-opus-4-6'])
    expect(built.models[0]?.context).toBe(200000)
    expect(built.models[0]?.billing).toBeUndefined()
  })
})

describe('parseModelIdsPayload', () => {
  test('reads non-empty string ids', () => {
    expect(parseModelIdsPayload({ data: [{ id: 'a' }, { id: 'b' }, { id: '' }, { other: 1 }, 'junk'] })).toEqual(['a', 'b'])
  })
  test('returns empty for malformed payloads', () => {
    expect(parseModelIdsPayload(null)).toEqual([])
    expect(parseModelIdsPayload({})).toEqual([])
    expect(parseModelIdsPayload({ data: 'nope' })).toEqual([])
  })
})

describe('oauthProviderHasLiveModels', () => {
  test('only openai and anthropic', () => {
    expect(oauthProviderHasLiveModels('openai')).toBe(true)
    expect(oauthProviderHasLiveModels('anthropic')).toBe(true)
    expect(oauthProviderHasLiveModels('xai')).toBe(false)
  })
})

describe('fetchLiveOAuthModelIds', () => {
  test('fetches openai ids with a bearer token', async () => {
    let seenUrl = ''
    let seenAuth: string | undefined
    stubFetch(async (input, init) => {
      seenUrl = String(input)
      seenAuth = (init?.headers as Record<string, string> | undefined)?.Authorization
      return new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), { status: 200 })
    })
    expect(await fetchLiveOAuthModelIds('openai', 'tok')).toEqual(['a', 'b'])
    expect(seenUrl).toBe(OPENAI_MODELS_URL)
    expect(seenAuth).toBe('Bearer tok')
  })
  test('fetches anthropic ids with api key and version headers', async () => {
    let seenUrl = ''
    let headers: Record<string, string> = {}
    stubFetch(async (input, init) => {
      seenUrl = String(input)
      headers = (init?.headers as Record<string, string> | undefined) ?? {}
      return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 })
    })
    expect(await fetchLiveOAuthModelIds('anthropic', 'tok')).toEqual(['m1'])
    expect(seenUrl).toBe(ANTHROPIC_MODELS_URL)
    expect(headers['x-api-key']).toBe('tok')
    expect(headers['anthropic-version']).toBe('2023-06-01')
  })
  test('returns empty without fetching for providers without a live endpoint', async () => {
    let called = false
    stubFetch(async () => {
      called = true
      return new Response('{}', { status: 200 })
    })
    expect(await fetchLiveOAuthModelIds('xai', 'tok')).toEqual([])
    expect(called).toBe(false)
  })
  test('rejects on non-ok responses', async () => {
    stubFetch(async () => new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }))
    await expect(fetchLiveOAuthModelIds('openai', 'tok')).rejects.toThrow('models catalog request failed')
  })
})

describe('withPreservedModels', () => {
  test('copies stored models from the previous credential', () => {
    const prev = credential({ availableModelIds: ['a'], availableModels: [{ id: 'a', name: 'A', context: 1, output: 1, supports: ['text'] }] })
    const next = withPreservedModels(credential({ access: 'fresh' }), prev)
    expect(next.access).toBe('fresh')
    expect(next.availableModelIds).toEqual(['a'])
    expect(next.availableModels?.[0]?.id).toBe('a')
  })
  test('leaves the next credential alone when nothing is stored', () => {
    const next = withPreservedModels(credential({ access: 'fresh' }), credential())
    expect(next.availableModelIds).toBeUndefined()
    expect(next.availableModels).toBeUndefined()
  })
})

const authStub = (id: string): OAuthAuth => ({
  id,
  name: id,
  login: async () => credential(),
  refresh: async () => credential(),
  toAuth: () => ({ apiKey: 'x' }),
})

describe('oauthProviderCatalogSupported', () => {
  test('supports providers with live or catalog sources', () => {
    for (const id of ['openai', 'anthropic', 'xai', 'openrouter', 'github-copilot']) expect(oauthProviderCatalogSupported(id)).toBe(true)
    expect(oauthProviderCatalogSupported('kimi-coding')).toBe(false)
    expect(oauthProviderCatalogSupported('nope')).toBe(false)
  })
})

describe('populateOAuthModels', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-populate-'))
    initLockDir(dir)
    initAuthFilePath(join(dir, 'auth.json'))
  })
  afterEach(async () => {
    resetAuthCache()
    await rm(dir, { recursive: true, force: true })
  })
  test('enriches openai ids from the live endpoint and stores them', async () => {
    stubFetch(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5.5' }] }), { status: 200 }))
    const result = await populateOAuthModels(authStub('openai'), credential(), { loadCatalog: async () => catalogFixture() })
    expect(result.modelIds).toEqual(['gpt-5.5'])
    expect(result.models[0]?.context).toBe(400000)
    expect(getCredential('openai')?.availableModelIds).toEqual(['gpt-5.5'])
  })
  test('stores anthropic ids from the live endpoint', async () => {
    stubFetch(async () => new Response(JSON.stringify({ data: [{ id: 'claude-opus-4-6' }] }), { status: 200 }))
    const result = await populateOAuthModels(authStub('anthropic'), credential(), { loadCatalog: async () => catalogFixture() })
    expect(result.modelIds).toEqual(['claude-opus-4-6'])
    expect(getCredential('anthropic')?.availableModelIds).toEqual(['claude-opus-4-6'])
  })
  test('falls back to the catalog when the live endpoint fails', async () => {
    stubFetch(async () => {
      throw new Error('network down')
    })
    const result = await populateOAuthModels(authStub('openai'), credential(), { loadCatalog: async () => catalogFixture() })
    expect(result.modelIds.length).toBeGreaterThan(0)
    expect(result.modelIds).not.toContain('gpt-4o')
  })
  test('keeps stored account models when there is no live endpoint', async () => {
    const stored = [{ id: 'account-only', name: 'Account Only', context: 1, output: 1, supports: ['text'] }]
    const result = await populateOAuthModels(authStub('github-copilot'), credential({ availableModelIds: ['account-only'], availableModels: stored }), { loadCatalog: async () => catalogFixture() })
    expect(result.modelIds).toEqual(['account-only'])
    expect(result.models).toEqual(stored)
  })
  test('re-enriches stored ids from the catalog when only ids were kept', async () => {
    const result = await populateOAuthModels(authStub('kimi-coding'), credential({ availableModelIds: ['gpt-5.5'] }), { loadCatalog: async () => catalogFixture() })
    expect(result.modelIds).toEqual(['gpt-5.5'])
    expect(result.models[0]?.name).toBe('GPT-5.5')
  })
  test('leaves the credential untouched when nothing resolves', async () => {
    await setCredential('kimi-coding', credential())
    const result = await populateOAuthModels(authStub('kimi-coding'), credential(), { loadCatalog: async () => undefined })
    expect(result).toEqual({ credential: expect.anything(), modelIds: [], models: [] })
    expect(getCredential('kimi-coding')?.availableModelIds).toBeUndefined()
  })
})
