import { describe, expect, test } from 'bun:test'
import { normalizeDomain, parseGitHubCopilotModelCatalog } from '../../src/auth/github-copilot.ts'
import { decodeJwt, getAccountId } from '../../src/auth/openai.ts'

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken(accountId: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none' }))
  const payload = base64UrlEncode(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }))
  return `${header}.${payload}.sig`
}

describe('decodeJwt', () => {
  test('decodes base64url payload without padding', () => {
    const token = makeToken('acc123')
    expect(token.split('.')[1]?.includes('=')).toBe(false)
    expect(getAccountId(token)).toBe('acc123')
    expect(decodeJwt(token)?.['https://api.openai.com/auth']).toEqual({ chatgpt_account_id: 'acc123' })
  })
  test('returns null for malformed tokens', () => {
    expect(decodeJwt('not-a-token')).toBeNull()
    expect(decodeJwt('a.b')).toBeNull()
    expect(getAccountId('a.b.c')).toBeNull()
  })
})

describe('normalizeDomain', () => {
  test('preserves custom port', () => {
    expect(normalizeDomain('ghe.example.com:8443')).toBe('ghe.example.com:8443')
  })
  test('trims scheme path and lowercases', () => {
    expect(normalizeDomain('  https://GHE.Example.COM:8443/path ')).toBe('ghe.example.com:8443')
  })
  test('returns null for blank', () => {
    expect(normalizeDomain('   ')).toBeNull()
  })
})

describe('parseGitHubCopilotModelCatalog', () => {
  const usable = { capabilities: { limits: { max_output_tokens: 100, max_prompt_tokens: 1000 }, supports: { tool_calls: true } } }
  test('returns picker enabled models', () => {
    const raw = { data: [{ id: 'a', model_picker_enabled: true, policy: { state: 'enabled' }, ...usable }] }
    expect(parseGitHubCopilotModelCatalog(raw, true)).toEqual(['a'])
  })
  test('empty picker falls back to non-disabled models', () => {
    const raw = { data: [{ id: 'a', model_picker_enabled: false, policy: { state: 'enabled' }, ...usable }] }
    expect(parseGitHubCopilotModelCatalog(raw, true)).toEqual(['a'])
  })
  test('empty picker stays empty without fallback', () => {
    const raw = { data: [{ id: 'a', model_picker_enabled: false, policy: { state: 'enabled' }, ...usable }] }
    expect(parseGitHubCopilotModelCatalog(raw, false)).toEqual([])
  })
  test('throws on invalid shape', () => {
    expect(() => parseGitHubCopilotModelCatalog({ nope: 1 }, true)).toThrow('Invalid Copilot models response')
  })
  test('excludes models without limits or tool calls', () => {
    const raw = {
      data: [
        { id: 'ok', model_picker_enabled: true, policy: { state: 'enabled' }, ...usable },
        { id: 'no-limits', model_picker_enabled: true, policy: { state: 'enabled' }, capabilities: { supports: { tool_calls: true } } },
        { id: 'no-tools', model_picker_enabled: true, policy: { state: 'enabled' }, capabilities: { limits: { max_output_tokens: 1, max_prompt_tokens: 1 }, supports: {} } },
      ],
    }
    expect(parseGitHubCopilotModelCatalog(raw, true)).toEqual(['ok'])
  })
})
