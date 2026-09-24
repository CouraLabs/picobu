import { describe, expect, test } from 'bun:test'
import { createAuthorizationFlow } from '../../src/auth/openai.ts'

const REDIRECT_URI = 'http://localhost:1455/auth/callback'

describe('createAuthorizationFlow', () => {
  test('requests the API scopes required to call OpenAI after login', async () => {
    const { url } = await createAuthorizationFlow(REDIRECT_URI, 'state123')
    const scope = new URL(url).searchParams.get('scope')?.split(' ') ?? []
    for (const required of ['openid', 'profile', 'email', 'offline_access']) {
      expect(scope).toContain(required)
    }
  })
  test('targets the Codex authorize endpoint with PKCE and callback params', async () => {
    const { verifier, url } = await createAuthorizationFlow(REDIRECT_URI, 'state123')
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://auth.openai.com/oauth/authorize')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
    expect(parsed.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('state')).toBe('state123')
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy()
    expect(parsed.searchParams.get('id_token_add_organizations')).toBe('true')
    expect(parsed.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(parsed.searchParams.get('originator')).toBe('codex_cli_rs')
    expect(verifier.length).toBeGreaterThan(0)
  })
})
