import { describe, expect, test } from 'bun:test'
import { listSubagents } from '../../src/agent/agents/subagents.ts'
import { parseMarkdown } from '../../src/agent/markdown/markdown-parser.ts'
import { SpawnToolOutputSchema } from '../../src/agent/tools/flow/spawn.ts'
import { isSpawnTool, spawnSessionId, spawnSubagentName, spawnSummary } from '../../src/tui/components/session/tools/tool-summary.ts'

describe('spawn tool view helpers', () => {
  test('detects spawn parts by static and dynamic names', () => {
    expect(isSpawnTool({ type: 'tool-spawn' })).toBe(true)
    expect(isSpawnTool({ type: 'dynamic-tool', toolName: 'spawn' })).toBe(true)
    expect(isSpawnTool({ type: 'tool-read' })).toBe(false)
  })
  test('extracts subagent name, session id, and summary', () => {
    expect(spawnSubagentName({ subagent: 'explorer' })).toBe('explorer')
    expect(spawnSubagentName({})).toBeUndefined()
    expect(spawnSessionId({ sessionId: 'abc123', summary: 'done' })).toBe('abc123')
    expect(spawnSessionId({ summary: 'done' })).toBeUndefined()
    expect(spawnSummary({ summary: 'done' })).toBe('done')
    expect(spawnSummary({})).toBeUndefined()
  })
  test('spawn output accepts payloads without sessionId', () => {
    const legacy = SpawnToolOutputSchema.parse({
      summary: 'done',
    })
    expect(legacy.sessionId).toBeUndefined()
    const current = SpawnToolOutputSchema.parse({
      sessionId: 'abc123',
      summary: 'done',
    })
    expect(current.sessionId).toBe('abc123')
  })
})

describe('built-in subagents', () => {
  test('each built-in keeps its own name and description', async () => {
    const names = (await listSubagents()).map((s) => s.name).sort()
    expect(names).toEqual(['Executor', 'Explorer', 'Reviewer'])
    for (const subagent of await listSubagents()) {
      expect(subagent.description.length).toBeGreaterThan(0)
    }
  })
  test('frontmatter parses after leading blank lines', () => {
    const parsed = parseMarkdown('\n\n---\nname: Explorer\n---\nbody')
    expect(parsed.name).toBe('Explorer')
    expect(parsed.content).toBe('body')
  })
})
