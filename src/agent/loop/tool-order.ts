import type { ToolKind } from '@agent/tools/toolset.ts'

const TOOL_KIND_RANK: Record<ToolKind, number> = { flow: 0, filesystem: 1, external: 2, integration: 2, mcp: 2 }

export const buildToolOrder = (names: readonly string[], kindOf: (name: string) => ToolKind | undefined): string[] => {
  const unique = [...new Set(names)]
  return unique.sort((a, b) => {
    const rankA = TOOL_KIND_RANK[kindOf(a) ?? 'mcp']
    const rankB = TOOL_KIND_RANK[kindOf(b) ?? 'mcp']
    if (rankA !== rankB) return rankA - rankB
    return a < b ? -1 : a > b ? 1 : 0
  })
}
