import { describe, expect, test } from 'bun:test'
import type { LoopMessage } from '../../src/agent/loop/create-loop.ts'
import { resolveModelRef } from '../../src/agent/model/resolver.ts'
import { options } from '../../src/config/options.ts'
import {
  getCacheSummary,
  getContextLabel,
  getContextPercent,
  getContextValue,
  getInputLabel,
  getOutputLabel,
  lastTokensFromMessages,
  normalizeUsageTokens,
} from '../../src/tui/components/session/status/session-status-data.ts'

describe('normalizeUsageTokens', () => {
  test('last step tokens stay inclusive of cache', () => {
    const tokens = normalizeUsageTokens({ inputTokens: 120_000, outputTokens: 5_000, cacheReadTokens: 110_000, cacheWriteTokens: 300, totalTokens: 125_000 })
    expect(tokens?.prompt).toBe(120_000)
    expect(tokens?.completion).toBe(5_000)
    expect(tokens?.total).toBe(125_000)
    expect(tokens?.cacheTotal).toBe(110_300)
    expect(tokens?.noCache).toBe(9_700)
  })
  test('derives noCache and total when absent', () => {
    const tokens = normalizeUsageTokens({ inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 100, cacheWriteTokens: 200 })
    expect(tokens?.noCache).toBe(700)
    expect(tokens?.total).toBe(1_500)
  })
  test('passes computed through for totals display', () => {
    const tokens = normalizeUsageTokens({
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      computed: { accNoCacheInputTokens: 700, accOutputTokens: 500, accCacheReadTokens: 100, accCacheWriteTokens: 200, accReasoningTokens: 0, accTextTokens: 0 },
    })
    expect(tokens?.computed?.accOutputTokens).toBe(500)
    expect(tokens?.prompt).toBe(100)
  })
  test('returns undefined for empty or non-object input', () => {
    expect(normalizeUsageTokens(undefined)).toBeUndefined()
    expect(normalizeUsageTokens({})).toBeUndefined()
    expect(normalizeUsageTokens({ inputTokens: 0, outputTokens: 0 })).toBeUndefined()
  })
})

const msg = (role: 'user' | 'assistant', usage: unknown): LoopMessage =>
  ({ id: `m${Math.random()}`, role, metadata: usage ? { usage } : {}, parts: [{ type: 'text', text: 'x' }] }) as unknown as LoopMessage

describe('lastTokensFromMessages', () => {
  test('picks the last assistant message with output tokens > 0', () => {
    const messages = [msg('user', null), msg('assistant', { inputTokens: 10, outputTokens: 0 }), msg('assistant', { inputTokens: 100, outputTokens: 5 }), msg('user', null)]
    expect(lastTokensFromMessages(messages)?.total).toBe(105)
  })
  test('skips user messages after the last qualifying assistant message', () => {
    const messages = [msg('assistant', { inputTokens: 100, outputTokens: 5 }), msg('user', { inputTokens: 999, outputTokens: 999 })]
    expect(lastTokensFromMessages(messages)?.total).toBe(105)
  })
  test('returns undefined when no assistant message has usage', () => {
    expect(lastTokensFromMessages([msg('user', null), msg('assistant', { inputTokens: 10, outputTokens: 0 })])).toBeUndefined()
    expect(lastTokensFromMessages([])).toBeUndefined()
  })
})

describe('context labels', () => {
  const tokens = normalizeUsageTokens({ inputTokens: 2_000, outputTokens: 400, cacheReadTokens: 100_000, cacheWriteTokens: 500, totalTokens: 2_400 })
  test('context value equals last-step totalTokens', () => {
    expect(getContextValue(tokens)).toBe(2_400)
    expect(getContextValue(undefined)).toBe(0)
  })
  test('percent rounds against the model limit', () => {
    const key = options.providers
      .flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`))
      .find((k) => {
        try {
          return (resolveModelRef(k).modelMeta.context ?? 0) > 0
        } catch {
          return false
        }
      })
    if (!key) return
    expect(getContextPercent(key, 262_144)).toBe(Math.round((262_144 / (resolveModelRef(key).modelMeta.context ?? 1)) * 100))
  })
  test('no limit reports tokens without percentage', () => {
    expect(getContextLabel(undefined, 5_000)).toBe('5K')
  })
})

describe('segment labels', () => {
  test('input reports last-step prompt size', () => {
    expect(getInputLabel(normalizeUsageTokens({ inputTokens: 120_000, outputTokens: 1, totalTokens: 120_001 }))).toBe('120K')
    expect(getInputLabel(undefined)).toBe('0')
  })
  test('output reports last-step completion size', () => {
    expect(getOutputLabel(normalizeUsageTokens({ inputTokens: 1, outputTokens: 400, totalTokens: 401 }))).toBe('400')
    expect(getOutputLabel(undefined)).toBe('0')
  })
  test('cache reports total cache with hit percent of last-step prompt', () => {
    const usage = normalizeUsageTokens({ inputTokens: 102_500, outputTokens: 400, cacheReadTokens: 100_000, cacheWriteTokens: 500, totalTokens: 102_900 })
    expect(getCacheSummary(usage)).toBe('100.5K (98%)')
    expect(getCacheSummary(undefined)).toBe('0 (0%)')
    const emptyPrompt = normalizeUsageTokens({ inputTokens: 0, outputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 0, totalTokens: 10 })
    expect(getCacheSummary(emptyPrompt)).toBe('100 (0%)')
  })
})
