import { describe, expect, test } from 'bun:test'
import { NO_TOOLS } from '../../src/agent/agents/create-agent.ts'
import { AGENTS } from '../../src/agent/agents/registry.ts'
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
  test('repo_map is registered under the name the agent prompts use', () => {
    expect(availableToolNames.has('repo_map')).toBe(true)
  })

  for (const [agentId, agent] of Object.entries(AGENTS)) {
    if (agent.tools.length === 0) continue
    if (agent.tools.length === 1 && agent.tools[0] === NO_TOOLS) continue
    test(`agent "${agentId}" lists only available tools`, () => {
      const unknown = agent.tools.filter((name) => !availableToolNames.has(name))
      expect(unknown).toEqual([])
    })
  }
})
