import { describe, expect, test } from 'bun:test'
import { buildCopilotModelsFromCatalog, buildCopilotProviderModel, parseCopilotCatalog } from '../../src/auth/copilot-models.ts'

const item = (id: string, overrides?: Record<string, unknown>): unknown => ({
  id,
  name: `Name ${id}`,
  version: `${id}-2026-01-01`,
  model_picker_enabled: true,
  policy: { state: 'enabled' },
  capabilities: { family: 'gpt', limits: { max_output_tokens: 100, max_prompt_tokens: 1000 }, supports: { tool_calls: true } },
  ...overrides,
})

describe('parseCopilotCatalog', () => {
  test('selects picker enabled usable models', () => {
    const catalog = parseCopilotCatalog({ data: [item('a'), item('b', { model_picker_enabled: false })] }, false)
    expect(catalog.selectedIds).toEqual(['a'])
    expect([...catalog.pickerEnabled]).toEqual(['a'])
  })
  test('falls back to usable models when picker empty and allowed', () => {
    const catalog = parseCopilotCatalog({ data: [item('a', { model_picker_enabled: false })] }, true)
    expect(catalog.selectedIds).toEqual(['a'])
  })
  test('stays empty without fallback', () => {
    const catalog = parseCopilotCatalog({ data: [item('a', { model_picker_enabled: false })] }, false)
    expect(catalog.selectedIds).toEqual([])
  })
  test('excludes disabled and unusable models', () => {
    const catalog = parseCopilotCatalog(
      {
        data: [
          item('ok'),
          item('disabled', { policy: { state: 'disabled' } }),
          item('no-tools', { capabilities: { family: 'gpt', limits: { max_output_tokens: 1, max_prompt_tokens: 1 }, supports: { tool_calls: false } } }),
          item('no-limits', { capabilities: { family: 'gpt', supports: { tool_calls: true } } }),
        ],
      },
      true,
    )
    expect(catalog.selectedIds).toEqual(['ok'])
  })
})

describe('buildCopilotProviderModel', () => {
  test('maps limits vision reasoning billing and chat npm', () => {
    const raw = item('gpt-5', {
      supported_endpoints: ['/chat/completions'],
      billing: { token_prices: { batch_size: 1000, default: { cache_price: 1, input_price: 2, output_price: 4 } } },
      capabilities: {
        family: 'gpt',
        limits: { max_context_window_tokens: 2000, max_prompt_tokens: 1000, max_output_tokens: 100, vision: { max_prompt_image_size: 1, max_prompt_images: 1, supported_media_types: ['image/jpeg'] } },
        supports: { tool_calls: true, reasoning_effort: ['low', 'high'] },
      },
    })
    const parsed = parseCopilotCatalog({ data: [raw] }, false)
    const remote = parsed.usable[0]
    if (!remote) throw new Error('missing remote')
    const model = buildCopilotProviderModel(remote)
    expect(model.id).toBe('gpt-5')
    expect(model.context).toBe(2000)
    expect(model.output).toBe(100)
    expect(model.supports).toEqual(['text', 'vision'])
    expect(model.reasoning).toBe(true)
    expect(model.efforts).toEqual(['low', 'high'])
    expect(model.npm).toBe('@ai-sdk/openai-compatible')
    expect(model.billing?.input).toBe(20)
    expect(model.billing?.output).toBe(40)
    expect(model.billing?.cacheRead).toBe(10)
  })
  test('maps messages endpoint to anthropic npm', () => {
    const raw = item('claude-x', { supported_endpoints: ['/v1/messages'] })
    const parsed = parseCopilotCatalog({ data: [raw] }, false)
    const remote = parsed.usable[0]
    if (!remote) throw new Error('missing remote')
    expect(buildCopilotProviderModel(remote).npm).toBe('@ai-sdk/anthropic')
  })
  test('preserves previous name and billing when live lacks prices', () => {
    const raw = item('m1')
    const parsed = parseCopilotCatalog({ data: [raw] }, false)
    const remote = parsed.usable[0]
    if (!remote) throw new Error('missing remote')
    const model = buildCopilotProviderModel(remote, { id: 'm1', name: 'Custom', context: 1, output: 1, billing: { input: 9 } })
    expect(model.name).toBe('Custom')
    expect(model.billing?.input).toBe(9)
  })
})

describe('buildCopilotModelsFromCatalog', () => {
  test('builds only selected models', () => {
    const models = buildCopilotModelsFromCatalog({ data: [item('a'), item('b', { model_picker_enabled: false })] }, false)
    expect(models.map((model) => model.id)).toEqual(['a'])
  })
})
