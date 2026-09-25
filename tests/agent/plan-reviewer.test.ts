import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getSubagent } from '../../src/agent/agents/subagents.ts'
import { buildToolSet } from '../../src/agent/tools/toolset.ts'

const prompt = readFileSync(new URL('../../src/agent/prompts/plan-reviewer.md', import.meta.url), 'utf8')
const availableToolNames = new Set(
  buildToolSet({ sessionId: 'plan-reviewer-test', interactive: true })
    .getTools()
    .map((t) => t.name),
)

describe('plan-reviewer subagent', () => {
  test('is registered under the plan-reviewer id and Plan Reviewer name', async () => {
    const sub = await getSubagent('plan-reviewer')
    expect(sub?.name).toBe('Plan Reviewer')
    expect(await getSubagent('Plan Reviewer')).toBe(sub)
    expect(await getSubagent('plan reviewer')).toBe(sub)
  })

  test('lists only available tools', async () => {
    const sub = await getSubagent('plan-reviewer')
    for (const tool of sub?.tools ?? []) expect(availableToolNames.has(tool)).toBe(true)
  })

  test('prompt carries the verdict contract and spawn placeholder', async () => {
    const sub = await getSubagent('plan-reviewer')
    expect(sub?.prompt).toContain('[OKAY]')
    expect(sub?.prompt).toContain('[REJECT]')
    expect(prompt).toContain('<SPAWN_PROMPT>')
  })
})
