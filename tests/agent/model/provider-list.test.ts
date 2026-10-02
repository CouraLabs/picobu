import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { listProviders } from '../../../src/agent/model/provider-list.ts'
import { clearRuntimeApiKeyProviders, setRuntimeApiKeyProviders } from '../../../src/agent/model/runtime-providers.ts'
import type { ProviderOptions } from '../../../src/config/options.ts'
import { mockOptions, resetMockOptions } from '../../helpers/mock-options.ts'

const provider = (id: string, overrides?: Partial<ProviderOptions>): ProviderOptions => ({
  id,
  name: id,
  type: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  models: [{ id: 'm1', name: 'M1', context: 1000, output: 100 }],
  ...overrides,
})

beforeEach(() => {
  resetMockOptions()
  clearRuntimeApiKeyProviders()
})

afterEach(() => {
  clearRuntimeApiKeyProviders()
})

describe('listProviders', () => {
  test('returns configured providers with their models', () => {
    mockOptions.providers = [provider('configured')]
    const ids = listProviders().map((entry) => entry.id)
    expect(ids).toEqual(['configured'])
  })

  test('appends runtime providers that are not configured', () => {
    mockOptions.providers = [provider('configured')]
    setRuntimeApiKeyProviders([provider('runtime')])
    const ids = listProviders().map((entry) => entry.id)
    expect(ids).toEqual(['configured', 'runtime'])
  })

  test('lets a configured provider win over a runtime entry with the same id', () => {
    mockOptions.providers = [provider('dupe', { name: 'Configured' })]
    setRuntimeApiKeyProviders([provider('dupe', { name: 'Runtime' })])
    const entries = listProviders()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('Configured')
  })

  test('drops providers with no available models', () => {
    mockOptions.providers = [provider('empty', { models: [] })]
    expect(listProviders()).toEqual([])
  })
})
