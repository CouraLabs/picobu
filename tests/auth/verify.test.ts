import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { anthropicOAuth } from '../../src/auth/anthropic.ts'
import { githubCopilotOAuth } from '../../src/auth/github-copilot.ts'
import { openaiOAuth } from '../../src/auth/openai.ts'
import { getCredential, initAuthFilePath, resetAuthCache } from '../../src/auth/store.ts'
import type { OAuthAuth, OAuthCredential } from '../../src/auth/types.ts'
import { confirmReLogin, verifyOAuthCredential } from '../../src/auth/verify.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const realFetch = globalThis.fetch

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'picobu-verify-'))
  initLockDir(dir)
  initAuthFilePath(join(dir, 'auth.json'))
})
afterEach(async () => {
  globalThis.fetch = realFetch
  resetAuthCache()
  await rm(dir, { recursive: true, force: true })
})

const credentialForAccess = (access: string, expires?: number): OAuthCredential => ({
  type: 'oauth',
  access,
  refresh: `refresh-${access}`,
  expires: expires ?? Date.now() + 3600000,
})

const jsonResponse = (payload: unknown): Response => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const stubFetch = (mock: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): void => {
  globalThis.fetch = Object.assign(mock, { preconnect: realFetch.preconnect })
}

const mockFetchJson = (payload: unknown): void => {
  stubFetch(async () => jsonResponse(payload))
}

const mockFetchFailure = (status: number, body: string): void => {
  stubFetch(async () => new Response(body, { status, statusText: 'Request failed' }))
}

const base64UrlEncodeText = (value: string): string => Buffer.from(value, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const openAiAccessTokenWithAccount = (accountId: string): string => {
  const header = base64UrlEncodeText(JSON.stringify({ alg: 'none' }))
  const payload = base64UrlEncodeText(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }))
  return `${header}.${payload}.sig`
}

const copilotModel = (id: string): unknown => ({
  id,
  model_picker_enabled: true,
  policy: { state: 'enabled' },
  capabilities: { limits: { max_output_tokens: 100, max_prompt_tokens: 1000 }, supports: { tool_calls: true } },
})

describe('verifyOAuthCredential', () => {
  test('reports openai working with catalog ids', async () => {
    mockFetchJson({ data: [{ id: 'a' }, { id: 'b' }] })
    const credential = credentialForAccess('access-1')
    const result = await verifyOAuthCredential(openaiOAuth, credential)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelCount).toBe(2)
      expect(result.modelIds).toEqual(['a', 'b'])
      expect(result.credential.availableModelIds).toEqual(['a', 'b'])
    }
  })
  test('reports anthropic working with catalog ids', async () => {
    mockFetchJson({ data: [{ id: 'm1' }] })
    const credential = credentialForAccess('access-2')
    const result = await verifyOAuthCredential(anthropicOAuth, credential)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelCount).toBe(1)
      expect(result.modelIds).toEqual(['m1'])
      expect(result.credential.availableModelIds).toEqual(['m1'])
    }
  })
  test('reports copilot working and stores available ids', async () => {
    mockFetchJson({ data: [copilotModel('m1'), copilotModel('m2'), copilotModel('m3')] })
    const result = await verifyOAuthCredential(githubCopilotOAuth, credentialForAccess('copilot-token'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelCount).toBe(3)
      expect(result.modelIds).toEqual(['m1', 'm2', 'm3'])
      expect(result.credential.availableModelIds).toEqual(['m1', 'm2', 'm3'])
    }
    expect(getCredential('github-copilot')?.availableModelIds).toEqual(['m1', 'm2', 'm3'])
  })
  test('filters copilot models without tool calls like login does', async () => {
    mockFetchJson({
      data: [
        copilotModel('m1'),
        { id: 'm2', model_picker_enabled: true, policy: { state: 'enabled' }, capabilities: { limits: { max_output_tokens: 1, max_prompt_tokens: 1 }, supports: { tool_calls: false } } },
        { id: 'm3', policy: { state: 'enabled' }, capabilities: { limits: { max_output_tokens: 1, max_prompt_tokens: 1 }, supports: { tool_calls: true } } },
      ],
    })
    const result = await verifyOAuthCredential(githubCopilotOAuth, credentialForAccess('copilot-token'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelIds).toEqual(['m1'])
      expect(result.modelCount).toBe(1)
    }
  })
  test('reports failure on unauthorized catalog', async () => {
    mockFetchFailure(401, 'unauthorized')
    const result = await verifyOAuthCredential(openaiOAuth, credentialForAccess('bad-access'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('401')
  })
  test('reports failure on empty catalog', async () => {
    mockFetchJson({ data: [] })
    const result = await verifyOAuthCredential(anthropicOAuth, credentialForAccess('access-3'))
    expect(result).toEqual({ ok: false, error: 'models catalog was empty' })
  })
  test('reports ok for provider without catalog check when ids stored', async () => {
    const unknown: OAuthAuth = {
      id: 'nope',
      name: 'Nope',
      login: async () => credentialForAccess('x'),
      refresh: async () => credentialForAccess('x'),
      toAuth: () => ({ apiKey: 'x' }),
    }
    const withoutIds = await verifyOAuthCredential(unknown, credentialForAccess('x'))
    expect(withoutIds.ok).toBe(true)
    const withIds = await verifyOAuthCredential(unknown, { ...credentialForAccess('x'), availableModelIds: ['a'] })
    expect(withIds.ok).toBe(true)
    if (withIds.ok) expect(withIds.modelIds).toEqual(['a'])
  })
  test('refreshes expired credential then verifies', async () => {
    const token = openAiAccessTokenWithAccount('acc-9')
    const endpointFor = (input: string | URL | Request): string => {
      if (typeof input === 'string') return input
      return input instanceof URL ? input.href : input.url
    }
    stubFetch(async (input: string | URL | Request) => {
      if (endpointFor(input).includes('/oauth/token')) return jsonResponse({ access_token: token, refresh_token: 'r2', expires_in: 3600 })
      return jsonResponse({ data: [{ id: 'm1' }] })
    })
    const result = await verifyOAuthCredential(openaiOAuth, credentialForAccess('old-access', Date.now() - 1000))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelCount).toBe(1)
      expect(result.modelIds).toEqual(['m1'])
      expect(result.credential.access).toBe(token)
    }
    expect(getCredential('openai')?.access).toBe(token)
  })
  test('reports failure when refresh fails', async () => {
    mockFetchFailure(401, 'bad credentials')
    const result = await verifyOAuthCredential(openaiOAuth, credentialForAccess('old-access', Date.now() - 1000))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('refresh')
  })
})

describe('confirmReLogin', () => {
  test('declines without prompting when not interactive', async () => {
    let asked = false
    const result = await confirmReLogin(
      'OpenAI',
      async () => {
        asked = true
        return 'y'
      },
      false,
    )
    expect(result).toBe(false)
    expect(asked).toBe(false)
  })
  test('accepts yes answers', async () => {
    await expect(confirmReLogin('OpenAI', async () => 'y', true)).resolves.toBe(true)
    await expect(confirmReLogin('OpenAI', async () => 'YES', true)).resolves.toBe(true)
  })
  test('declines no answers and prompt errors', async () => {
    await expect(confirmReLogin('OpenAI', async () => 'n', true)).resolves.toBe(false)
    await expect(confirmReLogin('OpenAI', async () => '', true)).resolves.toBe(false)
    await expect(
      confirmReLogin(
        'OpenAI',
        async () => {
          throw new Error('closed')
        },
        true,
      ),
    ).resolves.toBe(false)
  })
})
