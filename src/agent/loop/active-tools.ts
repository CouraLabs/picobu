import { NO_TOOLS } from '@agent/agents/create-agent.ts'
import { CONFIG_GATED_TOOLS } from '@agent/loop/permissions.ts'

export const buildActiveTools = (declared: ReadonlyArray<string>, available: ReadonlyArray<string>, mcp: ReadonlyArray<string>): Array<string> => {
  if (declared.includes(NO_TOOLS)) return []
  if (declared.length === 0) return [...available].filter((name) => !CONFIG_GATED_TOOLS.includes(name))
  const availableSet = new Set(available)
  return [...new Set([...declared, ...mcp])].filter((name) => availableSet.has(name))
}
