import { describe, expect, test } from 'bun:test'
import { fenceFiletype, fenceLabel, isFence, planSegments } from '../../src/tui/components/session/tools/plan-blocks.ts'

const plan = '# Title\n```ts\nconst a = 1\n\nconst b = 2\n```\nDone'

describe('planSegments', () => {
  test('groups prose paragraphs and code fences into ordered segments', () => {
    expect(planSegments(plan)).toEqual([
      { index: 0, kind: 'prose', lang: '', text: '# Title', startLine: 1 },
      { index: 1, kind: 'code', lang: 'ts', text: 'const a = 1\n\nconst b = 2', startLine: 3 },
      { index: 2, kind: 'prose', lang: '', text: 'Done', startLine: 7 },
    ])
  })

  test('splits prose on blank lines into separate segments', () => {
    expect(planSegments('p1\n\np2')).toEqual([
      { index: 0, kind: 'prose', lang: '', text: 'p1', startLine: 1 },
      { index: 1, kind: 'prose', lang: '', text: 'p2', startLine: 3 },
    ])
  })

  test('keeps multi-line prose paragraphs together', () => {
    expect(planSegments('just prose\nmore prose')).toEqual([{ index: 0, kind: 'prose', lang: '', text: 'just prose\nmore prose', startLine: 1 }])
  })

  test('splits multiple tilde-fenced blocks with languages', () => {
    expect(planSegments('~~~python\nx = 1\n~~~\n~~~go\ny = 2')).toEqual([
      { index: 0, kind: 'code', lang: 'python', text: 'x = 1', startLine: 2 },
      { index: 1, kind: 'code', lang: 'go', text: 'y = 2', startLine: 5 },
    ])
  })

  test('keeps an unclosed fence as one code segment', () => {
    expect(planSegments('```ts\nconst a = 1\nconst b = 2')).toEqual([{ index: 0, kind: 'code', lang: 'ts', text: 'const a = 1\nconst b = 2', startLine: 2 }])
  })

  test('empty and blank-only plans yield no segments', () => {
    expect(planSegments('')).toEqual([])
    expect(planSegments('\n  \n\t')).toEqual([])
  })
})

describe('fenceLabel', () => {
  test('extracts the first info token', () => {
    expect(fenceLabel('```tsx title=x')).toBe('tsx')
    expect(fenceLabel('```')).toBe('')
    expect(fenceLabel('~~~go')).toBe('go')
    expect(fenceLabel('```   ')).toBe('')
  })
})

describe('isFence', () => {
  test('detects backtick and tilde fences', () => {
    expect(isFence('```ts')).toBe(true)
    expect(isFence('~~~')).toBe(true)
    expect(isFence('code')).toBe(false)
  })
})

describe('fenceFiletype', () => {
  test('maps labels through infoStringToFiletype and rejects blanks', () => {
    expect(fenceFiletype('')).toBeUndefined()
    expect(fenceFiletype('   ')).toBeUndefined()
    expect(fenceFiletype('ts')).toBe('typescript')
    expect(fenceFiletype('TSX')).toBe('typescriptreact')
    expect(typeof fenceFiletype('nope-lang')).toBe('string')
  })
})
