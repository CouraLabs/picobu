import { afterEach, describe, expect, test } from 'bun:test'
import { endpointHeadersFor, fetchProviderEndpoint, isFullEndpoint, resolveEndpointUrl } from '../../src/agent/model/provider-endpoints.ts'
import { formatStatusValue, getByPath, resolveHeaderValue, resolveStatusLineItem, resolveStatusLineValues } from '../../src/agent/model/provider-status.ts'
import type { ProviderOptions } from '../../src/config/options.ts'
import { normalizeStatusLine, normalizeStatusLines, selectStatusLineItems } from '../../src/config/provider-status-line.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const provider = (overrides?: Partial<ProviderOptions>): ProviderOptions => ({
  id: 'hyper',
  name: 'Charm Hyper',
  type: 'openai-compatible',
  baseUrl: 'https://hyper.charm.land/v1',
  apiKey: 'test-key',
  models: [],
  ...overrides,
})

describe('getByPath', () => {
  test('resolves nested dot paths', () => {
    expect(getByPath({ cost: { hypercredits: 42 } }, 'cost.hypercredits')).toBe(42)
  })
  test('resolves array indices', () => {
    expect(getByPath({ balances: [{ total: 7 }] }, 'balances.0.total')).toBe(7)
  })
  test('returns undefined for missing paths and out-of-range indices', () => {
    expect(getByPath({ a: 1 }, 'b.c')).toBeUndefined()
    expect(getByPath({ a: [1] }, 'a.5')).toBeUndefined()
    expect(getByPath(42, 'a')).toBeUndefined()
  })
})

describe('formatStatusValue', () => {
  test('formats primitives', () => {
    expect(formatStatusValue('abc')).toBe('abc')
    expect(formatStatusValue(12.5)).toBe('12.5')
    expect(formatStatusValue(false)).toBe('false')
  })
  test('stringifies objects and drops empty values', () => {
    expect(formatStatusValue({ a: 1 })).toBe('{"a":1}')
    expect(formatStatusValue(undefined)).toBeUndefined()
    expect(formatStatusValue(null)).toBeUndefined()
    expect(formatStatusValue('')).toBeUndefined()
  })
})

describe('resolveHeaderValue', () => {
  test('matches case-insensitively', () => {
    expect(resolveHeaderValue({ 'X-RateLimit-Remaining-Day': '99' }, 'x-ratelimit-remaining-day')).toBe('99')
  })
  test('returns undefined when absent', () => {
    expect(resolveHeaderValue(undefined, 'x-a')).toBeUndefined()
    expect(resolveHeaderValue({}, 'x-a')).toBeUndefined()
  })
})

describe('resolveStatusLineItem', () => {
  test('resolves header items', () => {
    expect(resolveStatusLineItem({ type: 'header', label: 'Rate Day', value: 'X-RateLimit-Remaining-Day' }, { headers: { 'x-ratelimit-remaining-day': '10' } })).toEqual({
      label: 'Rate Day',
      value: '10',
    })
  })
  test('resolves step-raw items from usage raw', () => {
    expect(resolveStatusLineItem({ type: 'step-raw', label: 'Run HyperCredits', value: 'cost.hypercredits' }, { raw: { cost: { hypercredits: 3 } } })).toEqual({
      label: 'Run HyperCredits',
      value: '3',
    })
  })
  test('resolves endpoint items from cached payloads', () => {
    expect(resolveStatusLineItem({ type: 'endpoint', label: 'HyperCredits', endpoint: '/credits', value: 'balance' }, { endpoints: { HyperCredits: { balance: 100 } } })).toEqual({
      label: 'HyperCredits',
      value: '100',
    })
  })
  test('falls back to dash placeholder when missing', () => {
    expect(resolveStatusLineItem({ type: 'header', label: 'Rate Day', value: 'x-missing' }, {})).toEqual({ label: 'Rate Day', value: '-' })
    expect(resolveStatusLineItem({ type: 'step-raw', label: 'Run HyperCredits', value: 'cost.hypercredits' }, {})).toEqual({ label: 'Run HyperCredits', value: '-' })
    expect(resolveStatusLineItem({ type: 'endpoint', label: 'HyperCredits', endpoint: '/credits', value: 'balance' }, {})).toEqual({ label: 'HyperCredits', value: '-' })
  })
})

describe('resolveStatusLineValues', () => {
  test('returns one entry per configured item', () => {
    const result = resolveStatusLineValues([{ type: 'header', label: 'Rate Day', value: 'x-day' }], { headers: { 'x-day': '5' } })
    expect(result).toEqual([{ label: 'Rate Day', value: '5' }])
  })
  test('returns empty without items', () => {
    expect(resolveStatusLineValues(undefined, {})).toEqual([])
    expect(resolveStatusLineValues([], {})).toEqual([])
  })
})

describe('normalizeStatusLines', () => {
  test('keeps entries with valid provider and items', () => {
    expect(normalizeStatusLines([{ provider: 'hyper', items: [{ type: 'header', label: 'Rate Day', value: 'x-day' }] }])).toEqual([
      { provider: 'hyper', items: [{ type: 'header', label: 'Rate Day', value: 'x-day' }] },
    ])
  })
  test('drops entries with missing provider or no valid items', () => {
    expect(
      normalizeStatusLines([
        { provider: '', items: [{ type: 'header', label: 'A', value: 'x-a' }] },
        { provider: 'hyper', items: [] },
        { provider: 'hyper', items: [{ type: 'header', label: '', value: '' }] },
        null,
      ]),
    ).toEqual([])
  })
  test('returns empty for non-array input', () => {
    expect(normalizeStatusLines(undefined)).toEqual([])
    expect(normalizeStatusLines({})).toEqual([])
  })
})

describe('selectStatusLineItems', () => {
  test('selects items for the matching provider', () => {
    const lines = [
      { provider: 'hyper', items: [{ type: 'header' as const, label: 'Rate Day', value: 'x-day' }] },
      { provider: 'openai', items: [{ type: 'header' as const, label: 'Other', value: 'x-o' }] },
    ]
    expect(selectStatusLineItems(lines, 'hyper')).toEqual([{ type: 'header', label: 'Rate Day', value: 'x-day' }])
  })
  test('returns empty without match', () => {
    expect(selectStatusLineItems([], 'hyper')).toEqual([])
    expect(selectStatusLineItems(undefined, 'hyper')).toEqual([])
  })
})

describe('normalizeStatusLine', () => {
  test('keeps valid items and drops invalid ones', () => {
    expect(
      normalizeStatusLine({
        items: [
          { type: 'header', label: 'Rate Day', value: 'x-day' },
          { type: 'step-raw', label: 'Run', value: 'cost.x' },
          { type: 'endpoint', label: 'Bal', endpoint: '/credits', value: 'balance' },
          { type: 'header', label: '', value: 'x-empty' },
          { type: 'unknown', label: 'Bad', value: 'x' },
          { type: 'endpoint', label: 'NoUrl', value: 'balance' },
          { type: 'endpoint', label: 'BadScheme', endpoint: 'ftp://x', value: 'balance' },
        ],
      }),
    ).toEqual({
      items: [
        { type: 'header', label: 'Rate Day', value: 'x-day' },
        { type: 'step-raw', label: 'Run', value: 'cost.x' },
        { type: 'endpoint', label: 'Bal', endpoint: '/credits', value: 'balance' },
      ],
    })
  })
  test('accepts full endpoint urls', () => {
    expect(normalizeStatusLine({ items: [{ type: 'endpoint', label: 'Bal', endpoint: 'https://hyper.charm.land/v1/credits', value: 'balance' }] })).toEqual({
      items: [{ type: 'endpoint', label: 'Bal', endpoint: 'https://hyper.charm.land/v1/credits', value: 'balance' }],
    })
  })
  test('returns undefined for empty or non-object input', () => {
    expect(normalizeStatusLine(undefined)).toBeUndefined()
    expect(normalizeStatusLine({ items: [] })).toBeUndefined()
    expect(normalizeStatusLine({ items: [{ type: 'header', label: '', value: '' }] })).toBeUndefined()
  })
  test('caps items at eight', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ type: 'header', label: `L${index}`, value: `x-${index}` }))
    expect(normalizeStatusLine({ items })?.items).toHaveLength(8)
  })
})

describe('endpoint urls', () => {
  test('detects full urls', () => {
    expect(isFullEndpoint('https://example.com/x')).toBe(true)
    expect(isFullEndpoint('http://example.com/x')).toBe(true)
    expect(isFullEndpoint('/credits')).toBe(false)
    expect(isFullEndpoint('credits')).toBe(false)
  })
  test('uses full urls as-is', () => {
    expect(resolveEndpointUrl(provider(), 'https://hyper.charm.land/v1/credits')).toBe('https://hyper.charm.land/v1/credits')
  })
  test('joins relative paths to the provider base url', () => {
    expect(resolveEndpointUrl(provider(), '/credits')).toBe('https://hyper.charm.land/v1/credits')
    expect(resolveEndpointUrl(provider(), 'credits')).toBe('https://hyper.charm.land/v1/credits')
    expect(resolveEndpointUrl(provider({ baseUrl: 'https://example.com/v1/' }), '/credits')).toBe('https://example.com/v1/credits')
  })
})

describe('endpoint auth', () => {
  test('sends bearer api key when no authorization header exists', () => {
    expect(endpointHeadersFor(provider()).Authorization).toBe('Bearer test-key')
  })
  test('resolves env api key refs', () => {
    process.env.PICOBU_TEST_STATUS_KEY = 'env-secret'
    try {
      expect(endpointHeadersFor(provider({ apiKey: 'env:PICOBU_TEST_STATUS_KEY' })).Authorization).toBe('Bearer env-secret')
    } finally {
      delete process.env.PICOBU_TEST_STATUS_KEY
    }
  })
  test('keeps configured authorization headers', () => {
    const headers = endpointHeadersFor(provider({ headers: { Authorization: 'Custom 1' } }))
    expect(headers.Authorization).toBe('Custom 1')
  })
})

describe('fetchProviderEndpoint', () => {
  test('returns parsed json on success', async () => {
    let seenUrl: string | undefined
    globalThis.fetch = (async (url: string | URL | Request) => {
      seenUrl = String(url)
      return { ok: true, json: async () => ({ balance: 321 }) } as unknown as Response
    }) as unknown as typeof fetch
    await expect(fetchProviderEndpoint(provider(), '/credits')).resolves.toEqual({ balance: 321 })
    expect(seenUrl).toBe('https://hyper.charm.land/v1/credits')
  })
  test('throws on non-ok responses', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch
    await expect(fetchProviderEndpoint(provider(), '/credits')).rejects.toThrow()
  })
})
