import { describe, expect, test } from 'bun:test'
import type { LanguageModelUsage } from 'ai'
import type { LoopMessage } from '../../src/agent/loop/create-loop.ts'
import {
  buildMarker,
  cutForSend,
  estimateContextTokens,
  estimateMessageTokens,
  estimateTokensForText,
  findCutIndex,
  isCompactionMarker,
  lastMarkerIndex,
  planCompaction,
  usageContextTokens,
} from '../../src/agent/sessions/session-compact.ts'

const textMessage = (id: string, role: 'user' | 'assistant', tokens: number): LoopMessage => ({ id, role, parts: [{ type: 'text', text: 'x'.repeat(tokens * 4) }] }) as LoopMessage

const usage = (inputTokens: number, outputTokens: number): LanguageModelUsage =>
  ({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokenDetails: { textTokens: outputTokens, reasoningTokens: 0 },
  }) as LanguageModelUsage

const waitingMessage = (): LoopMessage =>
  ({ id: 'a-wait', role: 'assistant', parts: [{ type: 'tool-ask', toolCallId: 't1', state: 'output-available', input: {}, output: { status: 'pending' } }] }) as never as LoopMessage

const bigHistory = (): Array<LoopMessage> => [
  textMessage('u1', 'user', 12000),
  textMessage('a1', 'assistant', 12000),
  textMessage('u2', 'user', 12000),
  textMessage('a2', 'assistant', 12000),
  textMessage('u3', 'user', 100),
  textMessage('a3', 'assistant', 100),
]

describe('estimateTokensForText', () => {
  test('empty text costs nothing', () => {
    expect(estimateTokensForText('')).toBe(0)
  })
  test('rounds up by four chars', () => {
    expect(estimateTokensForText('abcd')).toBe(1)
    expect(estimateTokensForText('abcde')).toBe(2)
  })
})

describe('estimateMessageTokens', () => {
  test('sums text parts', () => {
    expect(estimateMessageTokens(textMessage('u', 'user', 10))).toBe(10)
  })
  test('measures non-text parts by serialized size', () => {
    const part = { type: 'tool-shell', toolCallId: 't', state: 'output-available', input: {}, output: 'ok' }
    const expected = Math.ceil(JSON.stringify(part).length / 4)
    expect(estimateMessageTokens({ id: 'a', role: 'assistant', parts: [part] } as never)).toBe(expected)
  })
  test('empty parts cost nothing', () => {
    expect(estimateMessageTokens({ id: 'u', role: 'user', parts: [] } as never)).toBe(0)
  })
})

describe('usageContextTokens and estimateContextTokens', () => {
  test('usage sums input and output', () => {
    expect(usageContextTokens(usage(90000, 5000))).toBe(95000)
  })
  test('prefers provider usage over local estimate', () => {
    expect(estimateContextTokens([textMessage('u', 'user', 1)], usage(90000, 5000))).toBe(95000)
  })
  test('falls back to local estimate without usage', () => {
    expect(estimateContextTokens([textMessage('u', 'user', 10), textMessage('a', 'assistant', 5)])).toBe(15)
  })
})

describe('compaction markers', () => {
  test('buildMarker creates a user message detected as marker', () => {
    const marker = buildMarker('m1', 'summary text', { tokensBefore: 95000, compactedAt: 1, summarizedCount: 4 })
    expect(marker.role).toBe('user')
    expect(isCompactionMarker(marker)).toBe(true)
    expect(isCompactionMarker(textMessage('u', 'user', 1))).toBe(false)
  })
  test('marker survives a json round trip', () => {
    const marker = buildMarker('m1', 'summary text', { tokensBefore: 95000, compactedAt: 1, summarizedCount: 4 })
    expect(isCompactionMarker(JSON.parse(JSON.stringify(marker)) as LoopMessage)).toBe(true)
  })
  test('lastMarkerIndex finds the newest marker', () => {
    const first = buildMarker('m1', 'one', { tokensBefore: 1, compactedAt: 1, summarizedCount: 1 })
    const second = buildMarker('m2', 'two', { tokensBefore: 2, compactedAt: 2, summarizedCount: 1 })
    expect(lastMarkerIndex([textMessage('u', 'user', 1)])).toBe(-1)
    expect(lastMarkerIndex([textMessage('u', 'user', 1), first, textMessage('a', 'assistant', 1), second, textMessage('u2', 'user', 1)])).toBe(3)
  })
})

describe('cutForSend', () => {
  test('returns history untouched without a marker', () => {
    const messages = bigHistory()
    expect(cutForSend(messages)).toBe(messages)
  })
  test('sends only the marker and later messages', () => {
    const messages = bigHistory()
    const marker = buildMarker('m1', 'summary', { tokensBefore: 1, compactedAt: 1, summarizedCount: 2 })
    const withMarker = [...messages.slice(0, 4), marker, ...messages.slice(4)]
    const cut = cutForSend(withMarker)
    expect(cut[0]).toBe(marker)
    expect(cut).toHaveLength(3)
  })
})

describe('findCutIndex', () => {
  test('returns -1 below the keep budget', () => {
    expect(findCutIndex([textMessage('u', 'user', 10), textMessage('a', 'assistant', 10)], 20000)).toBe(-1)
  })
  test('cuts at the next user boundary after the budget point', () => {
    expect(findCutIndex(bigHistory(), 20000)).toBe(2)
  })
  test('falls back to the budget point when no user boundary follows it', () => {
    const messages = [textMessage('u1', 'user', 12000), textMessage('a1', 'assistant', 12000), textMessage('a2', 'assistant', 30000)]
    expect(findCutIndex(messages, 20000)).toBe(2)
  })
  test('never summarizes pre-marker history twice', () => {
    const marker = buildMarker('m1', 'summary', { tokensBefore: 1, compactedAt: 1, summarizedCount: 2 })
    const messages = [
      textMessage('u0', 'user', 30000),
      marker,
      textMessage('u1', 'user', 15000),
      textMessage('a1', 'assistant', 15000),
      textMessage('u2', 'user', 100),
      textMessage('a2', 'assistant', 100),
    ]
    const cut = findCutIndex(messages, 20000)
    expect(cut).toBeGreaterThan(1)
    expect(cut).toBe(2)
  })
})

describe('planCompaction', () => {
  test('plans when usage passes 85 percent of the window', () => {
    const plan = planCompaction(bigHistory(), usage(90000, 5000), 100000, false)
    expect(plan?.tokens).toBe(95000)
    expect(plan?.cut).toBe(2)
    expect(plan?.start).toBe(0)
  })
  test('skips below the threshold', () => {
    expect(planCompaction(bigHistory(), usage(1000, 100), 100000, false)).toBeUndefined()
  })
  test('force compacts below the threshold', () => {
    expect(planCompaction(bigHistory(), usage(1000, 100), 100000, true)).toBeDefined()
  })
  test('skips without a usable window unless forced', () => {
    expect(planCompaction(bigHistory(), usage(90000, 5000), 0, false)).toBeUndefined()
    expect(planCompaction(bigHistory(), usage(90000, 5000), 0, true)).toBeDefined()
  })
  test('never compacts while waiting for a flow answer even when forced', () => {
    const messages = [...bigHistory(), waitingMessage()]
    expect(planCompaction(messages, usage(90000, 5000), 100000, false)).toBeUndefined()
    expect(planCompaction(messages, usage(90000, 5000), 100000, true)).toBeUndefined()
  })
})
