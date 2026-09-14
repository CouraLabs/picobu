import { describe, expect, test } from 'bun:test'
import { headersForProviderId, providerSpecFor } from '../../src/agent/model/providers/index.ts'
import { npmForProviderType, typeForNpm } from '../../src/agent/model/resolver.ts'
import { getProviderStatusLabel } from '../../src/tui/components/session/status/status-provider.tsx'

describe('provider specs', () => {
  test('exposes anthropic beta headers', () => {
    expect(providerSpecFor('anthropic')?.headers?.['anthropic-beta']).toContain('interleaved-thinking')
  })
  test('merges configured headers over spec defaults', () => {
    expect(headersForProviderId('openrouter', { 'X-Title': 'custom' })?.['X-Title']).toBe('custom')
    expect(headersForProviderId('openrouter', { 'X-Title': 'custom' })?.['HTTP-Referer']).toContain('picobu')
  })
  test('returns undefined without spec or configured headers', () => {
    expect(headersForProviderId('some-unknown-provider')).toBeUndefined()
  })
})

describe('npm mapping', () => {
  test('maps known npm packages to types', () => {
    expect(typeForNpm('@ai-sdk/openai')).toBe('openai')
    expect(typeForNpm('@ai-sdk/anthropic')).toBe('anthropic')
    expect(typeForNpm('@ai-sdk/xai')).toBe('openai-compatible')
    expect(typeForNpm(undefined)).toBe('openai-compatible')
  })
  test('maps types back to npm', () => {
    expect(npmForProviderType('openai')).toBe('@ai-sdk/openai')
    expect(npmForProviderType('anthropic')).toBe('@ai-sdk/anthropic')
    expect(npmForProviderType('openai-compatible')).toBe('@ai-sdk/openai-compatible')
  })
})

describe('SessionProviderStatus', () => {
  test('labels provider id and detail', () => {
    expect(getProviderStatusLabel(undefined)).toBeUndefined()
    expect(getProviderStatusLabel({ id: 'openai' })).toBe('openai')
    expect(getProviderStatusLabel({ id: 'xai', name: 'xAI', detail: 'SuperGrok' })).toBe('xAI · SuperGrok')
  })
})
