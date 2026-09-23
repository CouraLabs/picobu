import { describe, expect, test } from 'bun:test'
import { NO_TOOLS } from '../../src/agent/agents/create-agent.ts'
import { AGENTS } from '../../src/agent/agents/registry.ts'
import { BUILT_IN_SUBAGENTS } from '../../src/agent/agents/subagents.ts'
import { buildToolSet } from '../../src/agent/tools/toolset.ts'

const toolSet = buildToolSet({
  sessionId: 'drift-test',
  interactive: true,
  todoFilePath: '/tmp/picobu-drift-test/todo.json',
  checkpointsPath: '/tmp/picobu-drift-test/checkpoints.jsonl',
  spawn: { parentId: 'drift-test', depth: 0 } as never,
})

const availableToolNames = new Set(toolSet.getTools().map((t) => t.name))

describe('agent tool drift', () => {
  for (const [agentId, agent] of Object.entries(AGENTS)) {
    if (agent.tools.length === 0) continue
    if (agent.tools.length === 1 && agent.tools[0] === NO_TOOLS) continue
    test(`agent "${agentId}" lists only available tools`, () => {
      const unknown = agent.tools.filter((name) => !availableToolNames.has(name))
      expect(unknown).toEqual([])
    })
  }

  for (const [subagentId, subagent] of Object.entries(BUILT_IN_SUBAGENTS)) {
    if (subagent.tools.length === 0) continue
    if (subagent.tools.length === 1 && subagent.tools[0] === NO_TOOLS) continue
    test(`subagent "${subagentId}" lists only available tools`, () => {
      const unknown = subagent.tools.filter((name) => !availableToolNames.has(name))
      expect(unknown).toEqual([])
    })
  }
})
