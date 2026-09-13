import { describe, expect, test } from 'bun:test'
import { MAX_TOOL_OUTPUT_CHARS, TOOL_OUTPUT_TRUNCATION_SUFFIX, truncateToolOutput } from '../../src/agent/tools/truncate-output.ts'

describe('truncateToolOutput', () => {
  test('passes short strings through untouched', () => {
    expect(truncateToolOutput('hello')).toBe('hello')
  })
  test('truncates long strings with a suffix', () => {
    const out = truncateToolOutput('y'.repeat(MAX_TOOL_OUTPUT_CHARS + 10)) as string
    expect(out.endsWith(TOOL_OUTPUT_TRUNCATION_SUFFIX)).toBe(true)
    expect(out).toHaveLength(MAX_TOOL_OUTPUT_CHARS + TOOL_OUTPUT_TRUNCATION_SUFFIX.length)
  })
  test('truncates long content fields and preserves siblings', () => {
    const source = { filetype: 'text', content: 'z'.repeat(MAX_TOOL_OUTPUT_CHARS + 5) }
    const out = truncateToolOutput(source) as { filetype: string; content: string }
    expect(out.filetype).toBe('text')
    expect(out.content.endsWith(TOOL_OUTPUT_TRUNCATION_SUFFIX)).toBe(true)
    expect(source.content).toHaveLength(MAX_TOOL_OUTPUT_CHARS + 5)
  })
  test('returns short content objects by identity', () => {
    const source = { filetype: 'text', content: 'short' }
    expect(truncateToolOutput(source)).toBe(source)
  })
  test('passes other shapes through by identity', () => {
    const plain = { status: 'ok', count: 3 }
    expect(truncateToolOutput(plain)).toBe(plain)
    const list = ['a', 'b']
    expect(truncateToolOutput(list)).toBe(list)
  })
})
