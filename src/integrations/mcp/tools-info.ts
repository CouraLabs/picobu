import type { ListToolsResult } from '@ai-sdk/mcp'

const MAX_TOOL_NAME_LENGTH = 64

const NAME_PATTERN = /[^a-zA-Z0-9_-]/g

export const mcpToolName = (serverId: string, toolName: string): string => {
  const clean = (value: string) => value.replace(NAME_PATTERN, '_')
  const full = `mcp_${clean(serverId)}_${clean(toolName)}`
  if (full.length <= MAX_TOOL_NAME_LENGTH) return full
  const hashInput = `${serverId}:${toolName}`
  const suffix = [...hashInput]
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 46657, 7)
    .toString(36)
    .padStart(3, '0')
  const keptTool = clean(toolName).slice(0, MAX_TOOL_NAME_LENGTH - 5 - suffix.length - 1)
  return `mcp_${suffix}_${keptTool}`.slice(0, MAX_TOOL_NAME_LENGTH)
}

export const renderMcpToolInfo = (name: string, description: string | undefined): string => {
  const firstLine = (description ?? '(no description)').split('.')[0]?.trim()
  return `- ${name}: ${firstLine}`
}

export const renderMcpServerToolsInfo = (serverId: string, instructions: string | undefined, tools: ListToolsResult['tools']): string => {
  if (tools.length === 0) return ''
  const blocks = tools.map((tool) => renderMcpToolInfo(mcpToolName(serverId, tool.name), tool.description))
  return [...(instructions ? [`(MCP server "${serverId}": ${instructions})`] : []), ...blocks].join('\n')
}
