import { describe, expect, test } from 'bun:test'
import { buildToolOrder } from '../../src/agent/loop/tool-order.ts'
import { buildToolSet, type ToolKind } from '../../src/agent/tools/toolset.ts'

describe('buildToolOrder', () => {
  test('orders flow before filesystem before others with alpha tiebreak', () => {
    const kinds = new Map<string, ToolKind>([
      ['read', 'filesystem'],
      ['ask', 'flow'],
      ['webfetch', 'external'],
      ['edit', 'filesystem'],
      ['todo', 'flow'],
    ])
    expect(buildToolOrder(['read', 'webfetch', 'todo', 'edit', 'ask'], (name) => kinds.get(name))).toEqual(['ask', 'todo', 'edit', 'read', 'webfetch'])
  })
  test('unknown names sort last and duplicates collapse', () => {
    expect(buildToolOrder(['mcp_custom', 'read', 'mcp_custom', 'unknown-tool'], (name) => (name === 'read' ? 'filesystem' : undefined))).toEqual(['read', 'mcp_custom', 'unknown-tool'])
  })
  test('real toolset keeps flow first then filesystem then others', () => {
    const tools = buildToolSet()
    const kindByName = new Map(tools.getTools().map((t) => [t.name, t.kind]))
    const ordered = buildToolOrder(
      tools.getTools().map((t) => t.name),
      (name) => kindByName.get(name),
    )
    expect(ordered).toHaveLength(tools.getTools().length)
    const rank = (name: string): number => {
      const kind = kindByName.get(name)
      if (kind === 'flow') return 0
      if (kind === 'filesystem') return 1
      return 2
    }
    const ranks = ordered.map(rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })
})
