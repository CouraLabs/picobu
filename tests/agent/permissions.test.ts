import { describe, expect, test } from 'bun:test'
import { budgetExceeded } from '../../src/agent/loop/budget.ts'
import type { LoopStepCost } from '../../src/agent/loop/loop-stats.ts'
import { buildToolApproval, isAutoPilotGated, isGatedTool, toolNeedsApproval } from '../../src/agent/loop/permissions.ts'
import type { ToolKind } from '../../src/agent/tools/toolset.ts'

const kinds: Record<string, ToolKind> = { shell: 'filesystem', read: 'filesystem', ask: 'flow', websearch: 'external' }
const kindOf = (name: string): ToolKind | undefined => kinds[name]

describe('toolNeedsApproval', () => {
  test('unset tool asks in ask mode', () => {
    expect(toolNeedsApproval('shell', undefined, 'ask')).toBe(true)
  })
  test('allowed tool auto-runs', () => {
    expect(toolNeedsApproval('shell', { shell: true }, 'ask')).toBe(false)
  })
  test('denied tool asks', () => {
    expect(toolNeedsApproval('shell', { shell: false }, 'ask')).toBe(true)
  })
  test('mcp tool name asks when unset', () => {
    expect(toolNeedsApproval('mcp_demo_echo', undefined, 'ask')).toBe(true)
  })
  test('yolo mode never asks', () => {
    expect(toolNeedsApproval('shell', { shell: true }, 'yolo')).toBe(false)
    expect(toolNeedsApproval('shell', undefined, 'yolo')).toBe(false)
  })
})

describe('isGatedTool', () => {
  test('filesystem tools are gated', () => {
    expect(isGatedTool('shell', kindOf)).toBe(true)
  })
  test('unknown (mcp) tools are gated', () => {
    expect(isGatedTool('mcp_demo_echo', kindOf)).toBe(true)
  })
  test('flow and external tools are not gated', () => {
    expect(isGatedTool('ask', kindOf)).toBe(false)
    expect(isGatedTool('websearch', kindOf)).toBe(false)
  })
})

describe('buildToolApproval', () => {
  test('returns undefined for subagents', () => {
    expect(buildToolApproval({ mode: 'ask', kindOf, subagent: true })).toBeUndefined()
  })
  test('asks for a filesystem tool in ask mode', () => {
    const approval = buildToolApproval({ mode: 'ask', kindOf })
    expect(approval?.({ toolCall: { toolName: 'shell' } })).toBe('user-approval')
  })
  test('passes a non-gated tool through', () => {
    const approval = buildToolApproval({ mode: 'ask', kindOf })
    expect(approval?.({ toolCall: { toolName: 'websearch' } })).toBeUndefined()
  })
  test('passes everything in yolo mode', () => {
    const approval = buildToolApproval({ mode: 'yolo', kindOf })
    expect(approval?.({ toolCall: { toolName: 'shell' } })).toBeUndefined()
  })
  test('auto-runs an always-allowed tool', () => {
    const approval = buildToolApproval({ mode: 'ask', kindOf, permissions: { shell: true } })
    expect(approval?.({ toolCall: { toolName: 'shell' } })).toBeUndefined()
  })
})

const approve = async () => ({ approved: true })
const deny = async () => ({ approved: false, reason: 'outside the workspace' })

describe('isAutoPilotGated', () => {
  test('filesystem and unknown tools are gated', () => {
    expect(isAutoPilotGated('shell', kindOf)).toBe(true)
    expect(isAutoPilotGated('unknown_x', kindOf)).toBe(true)
  })
  test('flow tools are not gated', () => {
    expect(isAutoPilotGated('ask', kindOf)).toBe(false)
  })
})

describe('auto-pilot approval', () => {
  test('passes a flow tool through untouched', async () => {
    const approval = buildToolApproval({ mode: 'autopilot', kindOf, validate: approve })
    expect(await approval?.({ toolCall: { toolName: 'ask' } })).toBeUndefined()
  })
  test('approves a filesystem tool when the validator returns TRUE', async () => {
    const approval = buildToolApproval({ mode: 'autopilot', kindOf, validate: approve })
    expect(await approval?.({ toolCall: { toolName: 'shell' } })).toBe('approved')
  })
  test('denies a filesystem tool with the validator reason', async () => {
    const approval = buildToolApproval({ mode: 'autopilot', kindOf, validate: deny })
    expect(await approval?.({ toolCall: { toolName: 'shell' } })).toEqual({ type: 'denied', reason: 'outside the workspace' })
  })
  test('an always-allowed tool bypasses the validator', async () => {
    const throwing = async () => {
      throw new Error('validator must not run')
    }
    const approval = buildToolApproval({ mode: 'autopilot', kindOf, permissions: { shell: true }, validate: throwing })
    expect(await approval?.({ toolCall: { toolName: 'shell' } })).toBe('approved')
  })
  test('subagents are never gated', () => {
    expect(buildToolApproval({ mode: 'autopilot', kindOf, subagent: true })).toBeUndefined()
  })
  test('denies even when messages are omitted', async () => {
    const approval = buildToolApproval({ mode: 'autopilot', kindOf, validate: deny })
    expect(await approval?.({ toolCall: { toolName: 'shell', input: {} } })).toEqual({ type: 'denied', reason: 'outside the workspace' })
  })
})

describe('budgetExceeded', () => {
  const cost = (total: number): LoopStepCost => ({ input: 0, output: 0, cache: 0, total })
  test('true when over the limit', () => {
    expect(budgetExceeded(cost(5), 1)).toBe(true)
  })
  test('false when undefined (unlimited)', () => {
    expect(budgetExceeded(cost(5), undefined)).toBe(false)
  })
  test('false when zero (unlimited)', () => {
    expect(budgetExceeded(cost(5), 0)).toBe(false)
  })
  test('false when under the limit', () => {
    expect(budgetExceeded(cost(0.5), 1)).toBe(false)
  })
})
