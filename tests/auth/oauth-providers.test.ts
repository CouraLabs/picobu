import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listModels, resolveModelRef } from '../../src/agent/model/resolver.ts'
import { listOAuthProviderEntries, listProviders } from '../../src/auth/oauth-providers.ts'
import { initAuthFilePath, setCredential } from '../../src/auth/store.ts'
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
  test('skips providers already configured in options', async () => {
    await setCredential('github-copilot', copilotCredential(['a']))
    options.providers = [configuredCopilot()]
    expect(listOAuthProviderEntries()).toEqual([])
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
