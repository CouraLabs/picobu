import { describe, expect, test } from 'bun:test'
import { buildToolApproval, toolNeedsApproval } from '../../src/agent/loop/permissions.ts'
import type { ToolKind } from '../../src/agent/tools/toolset.ts'

const localKinds: Record<string, ToolKind> = { shell: 'filesystem', ask: 'flow' }
const kindOf = (name: string): ToolKind | undefined => localKinds[name]

describe('mcp tool gating', () => {
  test('an unlisted mcp name asks for approval in ask mode', () => {
    const approval = buildToolApproval({ mode: 'ask', kindOf })
    expect(approval?.({ toolCall: { toolName: 'mcp_demo_echo' } })).toBe('user-approval')
  })
  test('an always-allowed mcp name auto-runs', () => {
    const approval = buildToolApproval({ mode: 'ask', kindOf, permissions: { mcp_demo_echo: true } })
    expect(approval?.({ toolCall: { toolName: 'mcp_demo_echo' } })).toBeUndefined()
  })
  test('yolo passes mcp tools through', () => {
    const approval = buildToolApproval({ mode: 'yolo', kindOf })
    expect(approval?.({ toolCall: { toolName: 'mcp_demo_echo' } })).toBeUndefined()
  })
  test('toolNeedsApproval treats an unset mcp name as needing approval', () => {
    expect(toolNeedsApproval('mcp_demo_echo', undefined, 'ask')).toBe(true)
    expect(toolNeedsApproval('mcp_demo_echo', { mcp_demo_echo: true }, 'ask')).toBe(false)
  })
  test('auto-pilot approves an mcp tool when the validator returns TRUE', async () => {
    const approve = async () => ({ approved: true })
    const approval = buildToolApproval({ mode: 'autopilot', kindOf, validate: approve })
    expect(await approval?.({ toolCall: { toolName: 'mcp_demo_echo' } })).toBe('approved')
  })
  test('auto-pilot denies an mcp tool with the validator reason', async () => {
    const deny = async () => ({ approved: false, reason: 'outside the workspace' })
    const approval = buildToolApproval({ mode: 'autopilot', kindOf, validate: deny })
    expect(await approval?.({ toolCall: { toolName: 'mcp_demo_echo' } })).toEqual({ type: 'denied', reason: 'outside the workspace' })
  })
})
