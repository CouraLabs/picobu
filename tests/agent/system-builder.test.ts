import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_TOOLS } from '../../src/agent/agents/create-agent.ts'
import type { AgentType } from '../../src/agent/agents/types.ts'
import { createSystemBuilder } from '../../src/agent/loop/system-builder.ts'
import type { LoopConfig } from '../../src/agent/loop/types.ts'
import { buildToolSet } from '../../src/agent/tools/toolset.ts'
import type { McpManager, McpServerSnapshot } from '../../src/integrations/mcp/client.ts'

const fakeMcp = (snapshots: Array<McpServerSnapshot>): McpManager => ({
  tools: async () => ({}),
  snapshot: async () => snapshots,
  refresh: async () => {},
  connectAll: async () => {},
  close: async () => {},
  get generation() {
    return 0
  },
})

const agentWith = (tools: Array<string>): AgentType => ({ name: 'Probe', description: '', category: 'coding', tools, prompt: 'probe prompt' })

const withinTempCwd = async (run: (cwd: string) => Promise<void>): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), 'picobu-sys-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const build = (dir: string, agent: AgentType, mcp: McpManager): Promise<string> => {
  const getConfig = (): LoopConfig => ({ agentId: 'probe', modelKey: 'probe/probe', thinking: 'none', agentOverride: agent, spawn: { parentId: 'probe', depth: 0 } as never })
  return createSystemBuilder({ getConfig, cwd: dir, toolSet: buildToolSet(), mcp }).buildSystem('probe')
}

describe('createSystemBuilder mcp docs', () => {
  test('renders mcp tool docs for an agent that does not declare any mcp tool', async () => {
    await withinTempCwd(async (dir) => {
      const mcp = fakeMcp([{ id: 'deepwiki', type: 'http', connected: true, tools: [{ name: 'ask_wiki_question', description: 'Ask a repo question.', inputSchema: { type: 'object' } }] }])
      const system = await build(dir, agentWith(['read']), mcp)
      expect(system).toContain('mcp_deepwiki_ask_wiki_question: Ask a repo question')
    })
  })
  test('omits mcp docs for a NO_TOOLS agent', async () => {
    await withinTempCwd(async (dir) => {
      const mcp = fakeMcp([{ id: 'deepwiki', type: 'http', connected: true, tools: [{ name: 'ask_wiki_question', description: 'Ask a repo question.', inputSchema: { type: 'object' } }] }])
      const system = await build(dir, agentWith([NO_TOOLS]), mcp)
      expect(system).not.toContain('mcp_deepwiki_ask_wiki_question')
    })
  })
})

describe('createSystemBuilder subagent docs', () => {
  test('an empty-declared agent gets the subagents section', async () => {
    await withinTempCwd(async (dir) => {
      const system = await build(dir, agentWith([]), fakeMcp([]))
      expect(system).toContain('<Subagents>')
    })
  })
  test('an agent without the spawn tool gets no subagents section', async () => {
    await withinTempCwd(async (dir) => {
      const system = await build(dir, agentWith(['read']), fakeMcp([]))
      expect(system).not.toContain('<Subagents>')
    })
  })
})
