import { describe, expect, test } from 'bun:test'
import type { LoopMessage } from '../../src/agent/loop/create-loop.ts'
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
  test('always returns undefined', () => {
    expect(normalizeUsageTokens({} as never)).toBeUndefined()
    expect(normalizeUsageTokens(undefined)).toBeUndefined()
  })
})

const msg = (role: 'user' | 'assistant'): LoopMessage => ({ id: `m${Math.random()}`, role, metadata: {}, parts: [{ type: 'text', text: 'x' }] }) as unknown as LoopMessage

describe('lastTokensFromMessages', () => {
  test('always returns undefined', () => {
    expect(lastTokensFromMessages([msg('assistant')])).toBeUndefined()
    expect(lastTokensFromMessages([])).toBeUndefined()
  })
})

describe('context labels', () => {
  test('context value is always zero', () => {
    expect(getContextValue(undefined)).toBe(0)
    expect(getContextValue({ total: 2400 } as never)).toBe(0)
  })
  test('percent is always zero and label is zero', () => {
    expect(getContextPercent('model', 262_144)).toBe(0)
    expect(getContextLabel(undefined, 5_000)).toBe('0')
  })
})

describe('segment labels', () => {
  test('input and output always show zero', () => {
    expect(getInputLabel(undefined, undefined)).toBe('0')
    expect(getOutputLabel(undefined, undefined)).toBe('0')
  })
  test('cache always shows zero', () => {
    expect(getCacheSummary(undefined)).toBe('0 (0%)')
  })
})
