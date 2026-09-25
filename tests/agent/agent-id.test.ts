import { describe, expect, test } from 'bun:test'
import { agentIdFromName } from '../../src/agent/agents/agent-id.ts'

describe('agentIdFromName', () => {
  test('lowercases and hyphenates', () => {
    expect(agentIdFromName('Plan Reviewer')).toBe('plan-reviewer')
    expect(agentIdFromName('Plan')).toBe('plan')
    expect(agentIdFromName('OpenAI GPT-4o')).toBe('openai-gpt-4o')
  })
  test('trims and collapses runs of separators', () => {
    expect(agentIdFromName('  Coder ')).toBe('coder')
    expect(agentIdFromName('a  b')).toBe('a-b')
  })
})
