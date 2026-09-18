import { afterEach, describe, expect, test } from 'bun:test'
import { type AzTokenFetcher, azureOAuth, setAzTokenFetcherForTests } from '../../src/auth/azure.ts'
import type { AuthInteraction, OAuthCredential } from '../../src/auth/types.ts'

const interaction: AuthInteraction = {
  signal: new AbortController().signal,
  notify: () => {},
}

afterEach(() => {
  setAzTokenFetcherForTests(undefined)
})

const stubFetcher = (impl: AzTokenFetcher): { calls: Array<string> } => {
  const calls: Array<string> = []
  setAzTokenFetcherForTests(async (scope) => {
    calls.push(scope)
    return impl(scope)
  })
  return { calls }
}

describe('azure oauth', () => {
  test('login stores the real az token', async () => {
    const { calls } = stubFetcher(async () => ({ token: 'real-jwt-token', expires: 1234567890 }))
    const credential = await azureOAuth.login(interaction, { resourceName: 'my-resource' })
    expect(credential.access).toBe('real-jwt-token')
    expect(credential.expires).toBe(1234567890)
    expect(credential.accountId).toBe('my-resource')
    expect(calls).toEqual(['https://cognitiveservices.azure.com/.default'])
  })

  test('login fails loudly on an empty token', async () => {
    stubFetcher(async () => ({ token: '', expires: 1234567890 }))
    expect(azureOAuth.login(interaction, { resourceName: 'my-resource' })).rejects.toThrow('empty access token')
  })

  test('login fails without a resource name', async () => {
    const previous = process.env.AZURE_RESOURCE_NAME
    delete process.env.AZURE_RESOURCE_NAME
    try {
      expect(azureOAuth.login(interaction, undefined)).rejects.toThrow('resource name is required')
    } finally {
      if (previous !== undefined) process.env.AZURE_RESOURCE_NAME = previous
    }
  })

  test('refresh replaces the token and keeps the account id', async () => {
    stubFetcher(async () => ({ token: 'fresh-jwt-token', expires: 9876543210 }))
    const credential: OAuthCredential = { type: 'oauth', access: 'old-token', refresh: 'az-cli', expires: 1, accountId: 'my-resource' }
    const refreshed = await azureOAuth.refresh(credential, AbortSignal.timeout(5000))
    expect(refreshed.access).toBe('fresh-jwt-token')
    expect(refreshed.expires).toBe(9876543210)
    expect(refreshed.accountId).toBe('my-resource')
  })

  test('toAuth hands the real token to the SDK', () => {
    const auth = azureOAuth.toAuth({ type: 'oauth', access: 'real-jwt-token', refresh: 'az-cli', expires: 1, accountId: 'my-resource' })
    expect(auth.apiKey).toBe('real-jwt-token')
    expect(auth.baseUrl).toBe('https://my-resource.openai.azure.com')
  })
})
