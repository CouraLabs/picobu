import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { options, type ProviderOptions } from '../../src/config/options.ts'
import { getProviderStatusExtras } from '../../src/tui/components/session/status/provider-extras.ts'
import { getModelLabel, type SessionStatusProps } from '../../src/tui/components/session/status/status-meta.ts'

let prevProviders: Array<ProviderOptions> = []
let prevStatusLine: typeof options.statusLine = []

beforeEach(() => {
  prevProviders = options.providers
  prevStatusLine = options.statusLine
  options.providers = []
  options.statusLine = []
})

afterEach(() => {
  options.providers = prevProviders
  options.statusLine = prevStatusLine
})

const hyperProvider = (): ProviderOptions => ({
  id: 'hyper',
  name: 'Charm Hyper',
  type: 'openai-compatible',
  baseUrl: 'https://hyper.charm.land/v1',
  models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', context: 128000, output: 32000 }],
})

const statusProps = (overrides?: Partial<SessionStatusProps>): SessionStatusProps => ({
  agentId: 'coder',
  modelKey: 'hyper/deepseek-v4.1-flash',
  thinking: undefined,
  title: undefined,
  cwd: undefined,
  git: null,
  messages: [],
  streaming: false,
  ...overrides,
})

describe('getModelLabel', () => {
  test('returns a placeholder for a missing key', () => {
    expect(getModelLabel(undefined)).toBe('–')
  })
  test('returns the key untouched when there is no slash', () => {
    expect(getModelLabel('no-slash')).toBe('no-slash')
  })
  test('never throws and falls back to the raw key parts', () => {
    expect(getModelLabel('hyper/deepseek-v4.1-flash')).toBe('hyper deepseek-v4.1-flash')
  })
  test('resolves the friendly name once the provider is registered', () => {
    options.providers = [hyperProvider()]
    expect(getModelLabel('hyper/deepseek-v4.1-flash')).toBe('Charm Hyper DeepSeek V4.1 Flash')
  })
  test('reads the latest provider catalog on each call', () => {
    expect(getModelLabel('hyper/deepseek-v4.1-flash')).toBe('hyper deepseek-v4.1-flash')
    options.providers = [hyperProvider()]
    expect(getModelLabel('hyper/deepseek-v4.1-flash')).toBe('Charm Hyper DeepSeek V4.1 Flash')
  })
  test('keeps the provider name with an unknown model id', () => {
    options.providers = [hyperProvider()]
    expect(getModelLabel('hyper/missing-model')).toBe('Charm Hyper missing-model')
  })
})

describe('getProviderStatusExtras', () => {
  test('returns empty without configured status line items', () => {
    options.providers = [hyperProvider()]
    expect(getProviderStatusExtras(statusProps())).toEqual([])
  })
  test('resolves values for the matching provider', () => {
    options.providers = [hyperProvider()]
    options.statusLine = [{ provider: 'hyper', items: [{ type: 'header', label: 'Rate Day', value: 'x-day' }] }]
    const extras = getProviderStatusExtras(statusProps({ statsStatus: { finishReason: undefined, warnings: undefined, headers: { 'x-day': '7' }, endpoints: undefined } }))
    expect(extras).toEqual([{ label: 'Rate Day', value: '7' }])
  })
  test('returns empty instead of throwing for an unregistered provider', () => {
    options.statusLine = [{ provider: 'hyper', items: [{ type: 'header', label: 'Rate Day', value: 'x-day' }] }]
    expect(getProviderStatusExtras(statusProps())).toEqual([])
  })
})
