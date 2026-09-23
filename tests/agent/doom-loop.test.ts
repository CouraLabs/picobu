import { afterEach, describe, expect, test } from 'bun:test'
import { createDoomLoopGuard, DOOM_LOOP_TEXT_STEER, DOOM_LOOP_TOOL_STEER, detectDoomLoop, detectRepeatedToolCalls, type ToolCallLike } from '../../src/agent/loop/doom-loop.ts'
import { buildStopWhen } from '../../src/agent/loop/stop-conditions.ts'
import { options } from '../../src/config/options.ts'

const words = (n: number): string => Array.from({ length: n }, (_, i) => `t${i}`).join(' ')

const tenIdentical = (): Array<string> => Array.from({ length: 10 }, () => words(100))

const threeIdentical: Array<ToolCallLike> = Array.from({ length: 3 }, () => ({ toolName: 'bash', input: { cmd: 'ls' } }))

describe('detectDoomLoop', () => {
  test('fires on 10 near-identical parts', () => {
    expect(detectDoomLoop(tenIdentical())).toEqual({ triggered: true, runLength: 10 })
  })
  test('does not fire on distinct content', () => {
    const texts = Array.from({ length: 10 }, (_, i) => Array.from({ length: 20 }, (_, j) => `k${i}x${j}`).join(' '))
    expect(detectDoomLoop(texts).triggered).toBe(false)
  })
  test('fires at the 0.95 boundary', () => {
    const shared = words(95).split(' ')
    const texts = Array.from({ length: 10 }, (_, i) => [...shared, `u${i}a`, `u${i}b`, `u${i}c`, `u${i}d`, `u${i}e`].join(' '))
    expect(detectDoomLoop(texts).triggered).toBe(true)
  })
  test('does not fire below the boundary', () => {
    const shared = words(94).split(' ')
    const texts = Array.from({ length: 10 }, (_, i) => [...shared, `u${i}a`, `u${i}b`, `u${i}c`, `u${i}d`, `u${i}e`, `u${i}f`].join(' '))
    expect(detectDoomLoop(texts).triggered).toBe(false)
  })
  test('uses the min denominator for a short repetitive tail', () => {
    const short = words(20)
    const texts = [...Array.from({ length: 9 }, () => words(100)), short]
    expect(detectDoomLoop(texts).triggered).toBe(true)
  })
  test('is safe below the window', () => {
    expect(detectDoomLoop(Array.from({ length: 9 }, () => words(100)))).toEqual({ triggered: false, runLength: 9 })
  })
  test('is safe on empty input', () => {
    expect(detectDoomLoop([])).toEqual({ triggered: false, runLength: 0 })
  })
  test('skips whitespace-only parts', () => {
    expect(detectDoomLoop(Array.from({ length: 10 }, () => '   ')).triggered).toBe(false)
  })
})

describe('detectRepeatedToolCalls', () => {
  test('fires on 3 identical calls', () => {
    expect(detectRepeatedToolCalls(threeIdentical)).toEqual({ triggered: true, runLength: 3 })
  })
  test('does not fire on 3 different inputs', () => {
    const calls: Array<ToolCallLike> = ['ls', 'pwd', 'whoami'].map((cmd) => ({ toolName: 'bash', input: { cmd } }))
    expect(detectRepeatedToolCalls(calls).triggered).toBe(false)
  })
  test('does not fire on 3 different tool names', () => {
    const calls: Array<ToolCallLike> = ['a', 'b', 'c'].map((toolName) => ({ toolName, input: { cmd: 'ls' } }))
    expect(detectRepeatedToolCalls(calls).triggered).toBe(false)
  })
  test('counts the trailing identical run only', () => {
    expect(
      detectRepeatedToolCalls([
        { toolName: 'bash', input: { cmd: 'ls' } },
        { toolName: 'bash', input: { cmd: 'ls' } },
        { toolName: 'bash', input: { cmd: 'pwd' } },
      ]).triggered,
    ).toBe(false)
    const trailing: Array<ToolCallLike> = ['pwd', 'ls', 'ls', 'ls'].map((cmd) => ({ toolName: 'bash', input: { cmd } }))
    expect(detectRepeatedToolCalls(trailing)).toEqual({ triggered: true, runLength: 3 })
  })
  test('compares inputs by exact key order', () => {
    const calls: Array<ToolCallLike> = [
      { toolName: 't', input: { a: 1, b: 2 } },
      { toolName: 't', input: { a: 1, b: 2 } },
      { toolName: 't', input: { b: 2, a: 1 } },
    ]
    expect(detectRepeatedToolCalls(calls).triggered).toBe(false)
  })
  test('is safe below the window and on empty input', () => {
    expect(detectRepeatedToolCalls(threeIdentical.slice(0, 2)).triggered).toBe(false)
    expect(detectRepeatedToolCalls([])).toEqual({ triggered: false, runLength: 0 })
  })
})

describe('createDoomLoopGuard', () => {
  test('text strike steers once then halts', () => {
    const guard = createDoomLoopGuard()
    expect(guard.observe({ texts: tenIdentical(), toolCalls: [] })).toEqual({ steer: DOOM_LOOP_TEXT_STEER, halt: false })
    expect(guard.isHalted()).toBe(false)
    expect(guard.observe({ texts: tenIdentical(), toolCalls: [] })).toEqual({ halt: true, reason: 'text' })
    expect(guard.isHalted()).toBe(true)
  })
  test('tool strike steers once then halts', () => {
    const guard = createDoomLoopGuard()
    expect(guard.observe({ texts: [], toolCalls: threeIdentical })).toEqual({ steer: DOOM_LOOP_TOOL_STEER, halt: false })
    expect(guard.observe({ texts: [], toolCalls: threeIdentical })).toEqual({ halt: true, reason: 'tool' })
  })
  test('steer messages differ per signal', () => {
    expect(DOOM_LOOP_TEXT_STEER).not.toBe(DOOM_LOOP_TOOL_STEER)
  })
  test('resets strikes on divergence', () => {
    const guard = createDoomLoopGuard()
    guard.observe({ texts: tenIdentical(), toolCalls: [] })
    expect(guard.observe({ texts: [], toolCalls: [] })).toEqual({ halt: false })
    expect(guard.isHalted()).toBe(false)
    expect(guard.observe({ texts: tenIdentical(), toolCalls: [] })).toEqual({ steer: DOOM_LOOP_TEXT_STEER, halt: false })
  })
  test('clears the halt latch on a fresh turn', () => {
    const guard = createDoomLoopGuard()
    guard.observe({ texts: tenIdentical(), toolCalls: [] })
    guard.observe({ texts: tenIdentical(), toolCalls: [] })
    expect(guard.isHalted()).toBe(true)
    expect(guard.observe({ texts: [], toolCalls: [] })).toEqual({ halt: false })
    expect(guard.isHalted()).toBe(false)
    expect(guard.observe({ texts: tenIdentical(), toolCalls: [] })).toEqual({ steer: DOOM_LOOP_TEXT_STEER, halt: false })
  })
  test('clears the tool halt latch on a fresh turn', () => {
    const guard = createDoomLoopGuard()
    guard.observe({ texts: [], toolCalls: threeIdentical })
    guard.observe({ texts: [], toolCalls: threeIdentical })
    expect(guard.isHalted()).toBe(true)
    guard.observe({ texts: [], toolCalls: [] })
    expect(guard.isHalted()).toBe(false)
  })
  test('reset restores a halted guard', () => {
    const guard = createDoomLoopGuard()
    guard.observe({ texts: tenIdentical(), toolCalls: [] })
    guard.observe({ texts: tenIdentical(), toolCalls: [] })
    expect(guard.isHalted()).toBe(true)
    guard.reset()
    expect(guard.isHalted()).toBe(false)
  })
})

describe('harness.doomLoop', () => {
  const original = options.harness.doomLoop
  afterEach(() => {
    options.harness.doomLoop = original
  })
  test('defaults to enabled', () => {
    expect(options.harness.doomLoop !== false).toBe(true)
  })
  test('disables when explicitly false', () => {
    options.harness.doomLoop = false
    expect(options.harness.doomLoop !== false).toBe(false)
  })
})

describe('buildStopWhen with hasHalted', () => {
  const last = (conds: ReturnType<typeof buildStopWhen>) => conds[conds.length - 1]
  test('halts when the predicate is true', () => {
    const conds = buildStopWhen({ subagent: false, persistent: false, hasHalted: () => true })
    expect(last(conds)?.({ steps: [] })).toBe(true)
  })
  test('does not halt when the predicate is false', () => {
    const conds = buildStopWhen({ subagent: false, persistent: false, hasHalted: () => false })
    expect(last(conds)?.({ steps: [] })).toBe(false)
  })
  test('omits the halt predicate when not provided', () => {
    const conds = buildStopWhen({ subagent: false, persistent: false })
    expect(conds).toHaveLength(1)
    expect(last(conds)?.({ steps: [] })).toBe(false)
  })
  test('adds the halt predicate to persistent sessions', () => {
    const conds = buildStopWhen({ subagent: false, persistent: true, hasHalted: () => true })
    expect(conds).toHaveLength(3)
    expect(last(conds)?.({ steps: [] })).toBe(true)
  })
})
