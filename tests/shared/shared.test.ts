import { describe, expect, test } from 'bun:test'
import { mcpToolName } from '../../src/integrations/mcp/tools-info.ts'
import { detectFiletype } from '../../src/shared/filetype.ts'
import { clip, fmtCost, fmtDuration, fmtTokens, relTime } from '../../src/shared/format.ts'
import { countOccurrences, extractWords, textStats, truncate } from '../../src/shared/text-stats.ts'

describe('text stats', () => {
  test('splits on punctuation and whitespace', () => {
    expect(extractWords('hello, world! foo')).toEqual(['hello', 'world', 'foo'])
  })
  test('counts occurrences without overlap surprises', () => {
    expect(countOccurrences('aaa', 'aa')).toBe(1)
    expect(countOccurrences('abc', '')).toBe(0)
  })
  test('truncate respects tiny max', () => {
    expect(truncate('hello', 2)).toBe('he')
    expect(truncate('hello', 60)).toBe('hello')
    expect(truncate('hello world', 8)).toBe('hello...')
  })
  test('textStats aggregates', () => {
    const stats = textStats('hi there')
    expect(stats.words).toBe(2)
    expect(stats.lines).toBe(1)
  })
})

describe('format', () => {
  test('future time is just now', () => {
    expect(relTime(Date.now() + 60_000)).toBe('just now')
  })
  test('clip fmtTokens fmtCost fmtDuration', () => {
    expect(clip('abcdef', 3)).toBe('ab…')
    expect(fmtTokens(1500)).toBe('1.5K')
    expect(fmtCost(2)).toBe('$2')
    expect(fmtDuration(90)).toBe('1m 30s')
  })
})

describe('filetype', () => {
  test('maps extensions', () => {
    expect(detectFiletype('a/b.ts')).toBe('typescript')
    expect(detectFiletype('a/b.unknown')).toBe('text')
  })
  test('dotfiles are text', () => {
    expect(detectFiletype('.env')).toBe('text')
    expect(detectFiletype('dir/.env')).toBe('text')
  })
})

describe('mcp tool names', () => {
  test('long names with shared prefix do not collide', () => {
    const a = mcpToolName('srv', `${'x'.repeat(60)}_A_suffix_long`)
    const b = mcpToolName('srv', `${'x'.repeat(60)}_B_suffix_long`)
    expect(a).not.toBe(b)
    expect(a.length).toBeLessThanOrEqual(64)
    expect(b.length).toBeLessThanOrEqual(64)
  })
})
