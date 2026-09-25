import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { AGENTS, getAgent, listAgents } from '../../src/agent/agents/registry.ts'
import { buildActiveTools } from '../../src/agent/loop/active-tools.ts'

const optioneerMarkdown = readFileSync(new URL('../../src/agent/prompts/optioneer.md', import.meta.url), 'utf8')

describe('optioneer agent', () => {
  test("is registered with the display name Picobu's Optioneer", () => {
    const agent = getAgent('optioneer')
    expect(agent.name).toBe("Picobu's Optioneer")
  })
  test('declares the config tools', () => {
    const agent = getAgent('optioneer')
    expect(agent.tools).toContain('update-options')
    expect(agent.tools).toContain('reload-options')
    expect(agent.tools).toContain('read')
  })
  test('declares the artifact-authoring tools', () => {
    const agent = getAgent('optioneer')
    expect(agent.tools).toContain('write')
    expect(agent.tools).toContain('edit')
    expect(agent.tools).toContain('glob')
  })
  test('prompt documents harness.agent and artifact locations', () => {
    expect(optioneerMarkdown).toContain('harness.agent')
    expect(optioneerMarkdown).toContain('SKILL.md')
    expect(optioneerMarkdown).toContain('.agents/rules/')
    expect(optioneerMarkdown).toContain('plan-reviewer')
  })
  test('appears in the agent list', () => {
    expect(listAgents().map((a) => a.id)).toContain('optioneer')
    expect(Object.keys(AGENTS)).toContain('optioneer')
  })
})

describe('config tool gating', () => {
  const available = ['read', 'write', 'update-options', 'reload-options', 'mcp_a_x']
  test('an agent with empty declared tools does not get the config tools', () => {
    const active = buildActiveTools([], available, ['mcp_a_x'])
    expect(active).not.toContain('update-options')
    expect(active).not.toContain('reload-options')
    expect(active).toContain('read')
    expect(active).toContain('mcp_a_x')
  })
  test('an agent that declares the config tools gets them', () => {
    const active = buildActiveTools(['read', 'update-options', 'reload-options'], available, [])
    expect(active).toContain('update-options')
    expect(active).toContain('reload-options')
    expect(active).not.toContain('write')
  })
})
