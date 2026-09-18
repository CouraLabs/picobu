import { describe, expect, test } from 'bun:test'
import {
  appendLayoutLine,
  collapseSeparators,
  DEFAULT_SESSION_HEADER_LAYOUT,
  DEFAULT_SESSION_STATUS_LAYOUT,
  flattenLayoutLines,
  insertLayoutItem,
  lineHasVisibleItem,
  MAX_LAYOUT_GAP,
  MAX_SESSION_LAYOUT_ITEMS_PER_LINE,
  MAX_SESSION_LAYOUT_LINES,
  MIN_LAYOUT_GAP,
  moveLayoutItem,
  normalizeLayoutGap,
  normalizeSessionHeaderLayout,
  normalizeSessionStatusLayout,
  removeLayoutItem,
  removeLayoutLine,
  type SessionStatusLayout,
  setLayoutGaps,
  toLayoutConfig,
  unusedHeaderItems,
  unusedStatusItems,
} from '../../src/config/session-layout.ts'

const DEFAULT_STATUS_LINES: SessionStatusLayout['lines'] = [
  ['agent', 'separator', 'model', 'separator', 'effort', 'separator', 'run-state', 'separator', 'loading', 'session-title'],
  ['ttft', 'tps', 'separator', 'input', 'output', 'cache', 'cost'],
  ['sandbox', 'separator', 'msgs', 'tools', 'separator', 'queue', 'separator', 'jobs'],
  ['provider-items'],
]

describe('defaults', () => {
  test('status default matches the requested matrix with default gaps', () => {
    expect(DEFAULT_SESSION_STATUS_LAYOUT.lines).toEqual(DEFAULT_STATUS_LINES)
    expect(DEFAULT_SESSION_STATUS_LAYOUT.columnGap).toBe(1)
    expect(DEFAULT_SESSION_STATUS_LAYOUT.rowGap).toBe(0)
  })
  test('header default is a single flat line', () => {
    expect(DEFAULT_SESSION_HEADER_LAYOUT.lines).toEqual([['workspace', 'separator', 'context', 'separator', 'notification']])
    expect(DEFAULT_SESSION_HEADER_LAYOUT.columnGap).toBe(1)
    expect(DEFAULT_SESSION_HEADER_LAYOUT.rowGap).toBe(0)
  })
})

describe('normalizeSessionStatusLayout', () => {
  test('accepts the config object form', () => {
    const normalized = normalizeSessionStatusLayout({ lines: [['agent', 'cost']], columnGap: 2, rowGap: 3 })
    expect(normalized.lines).toEqual([['agent', 'cost']])
    expect(normalized.columnGap).toBe(2)
    expect(normalized.rowGap).toBe(3)
  })
  test('accepts the bare-array form with default gaps', () => {
    const normalized = normalizeSessionStatusLayout([['agent']])
    expect(normalized.lines).toEqual([['agent']])
    expect(normalized.columnGap).toBe(1)
    expect(normalized.rowGap).toBe(0)
  })
  test('rejects non-array and non-object input', () => {
    for (const value of [undefined, null, 'nope', 42, { lines: 'nope' }]) {
      expect(normalizeSessionStatusLayout(value)).toEqual(DEFAULT_SESSION_STATUS_LAYOUT)
    }
  })
  test('drops unknown ids and non-strings', () => {
    const normalized = normalizeSessionStatusLayout([['agent', 'bogus', 42, 'cost']])
    expect(normalized.lines).toEqual([['agent', 'cost']])
  })
  test('dedupes non-separator ids keeping the first occurrence', () => {
    const normalized = normalizeSessionStatusLayout([['agent', 'cost', 'agent', 'cost']])
    expect(normalized.lines).toEqual([['agent', 'cost']])
  })
  test('strips separators at line edges and adjacent duplicates', () => {
    expect(normalizeSessionStatusLayout([['separator', 'agent', 'separator', 'separator', 'cost', 'separator']]).lines).toEqual([['agent', 'separator', 'cost']])
  })
  test('drops lines that end up empty and falls back on empty input', () => {
    expect(normalizeSessionStatusLayout([[], ['agent']]).lines).toEqual([['agent']])
    expect(normalizeSessionStatusLayout([[], []])).toEqual(DEFAULT_SESSION_STATUS_LAYOUT)
  })
  test('persists an intentionally empty object config instead of resurrecting defaults', () => {
    expect(normalizeSessionStatusLayout({ lines: [], columnGap: 2, rowGap: 1 })).toEqual({ lines: [], columnGap: 2, rowGap: 1 })
    expect(normalizeSessionHeaderLayout({ lines: [] })).toEqual({ lines: [], columnGap: 1, rowGap: 0 })
  })
  test('caps lines and items per line', () => {
    const manyLines = Array.from({ length: MAX_SESSION_LAYOUT_LINES + 3 }, (_, index) => (index === 0 ? ['agent', 'cost'] : ['model', 'tps']))
    const normalized = normalizeSessionStatusLayout(manyLines)
    expect(normalized.lines.length).toBeLessThanOrEqual(MAX_SESSION_LAYOUT_LINES)
    const longLine = Array.from({ length: 50 }, () => 'cost')
    const capped = normalizeSessionStatusLayout([longLine])
    expect(capped.lines[0]?.length).toBeLessThanOrEqual(MAX_SESSION_LAYOUT_ITEMS_PER_LINE)
  })
})

describe('normalizeSessionHeaderLayout', () => {
  test('keeps only the first line', () => {
    const normalized = normalizeSessionHeaderLayout({ lines: [['workspace'], ['git']], columnGap: 1, rowGap: 0 })
    expect(normalized.lines).toEqual([['workspace']])
  })
  test('falls back to defaults for unknown items', () => {
    expect(normalizeSessionHeaderLayout([['bogus']])).toEqual(DEFAULT_SESSION_HEADER_LAYOUT)
  })
})

describe('normalizeLayoutGap', () => {
  test('clamps into the allowed range', () => {
    expect(normalizeLayoutGap(-5, 1)).toBe(MIN_LAYOUT_GAP)
    expect(normalizeLayoutGap(99, 1)).toBe(MAX_LAYOUT_GAP)
    expect(normalizeLayoutGap(2.9, 1)).toBe(2)
  })
  test('falls back on invalid values', () => {
    expect(normalizeLayoutGap('3', 1)).toBe(1)
    expect(normalizeLayoutGap(Number.NaN, 1)).toBe(1)
    expect(normalizeLayoutGap(undefined, 2)).toBe(2)
  })
})

describe('collapseSeparators', () => {
  const always = (): boolean => true
  test('collapses at edges', () => {
    expect(collapseSeparators(['separator', 'a', 'b', 'separator'], always)).toEqual(['a', 'b'])
  })
  test('collapses next to an invisible neighbour', () => {
    const visible = (item: string): boolean => item !== 'hidden'
    expect(collapseSeparators(['a', 'separator', 'hidden', 'separator', 'b'], visible)).toEqual(['a', 'separator', 'b'])
    expect(collapseSeparators(['hidden', 'separator', 'a'], visible)).toEqual(['a'])
  })
  test('collapses between two separators', () => {
    expect(collapseSeparators(['a', 'separator', 'separator', 'b'], always)).toEqual(['a', 'separator', 'b'])
  })
  test('keeps separators with visible content on both sides', () => {
    expect(collapseSeparators(['a', 'separator', 'b'], always)).toEqual(['a', 'separator', 'b'])
  })
})

describe('lineHasVisibleItem', () => {
  const visible = (item: string): boolean => item !== 'off'
  test('false when every item is an invisible non-separator', () => {
    expect(lineHasVisibleItem(['off', 'off'], visible)).toBe(false)
  })
  test('false for an empty or missing line', () => {
    expect(lineHasVisibleItem([], visible)).toBe(false)
    expect(lineHasVisibleItem(undefined, visible)).toBe(false)
  })
  test('true when any item is visible', () => {
    expect(lineHasVisibleItem(['off', 'on'], visible)).toBe(true)
  })
})

describe('mutation helpers', () => {
  const layout = (): SessionStatusLayout => ({
    lines: [
      ['agent', 'model'],
      ['ttft', 'cost'],
    ],
    columnGap: 1,
    rowGap: 0,
  })

  test('moveLayoutItem handles same-line reindexing', () => {
    const next = moveLayoutItem(layout(), { line: 0, index: 0 }, { line: 0, index: 2 })
    expect(next.lines[0]).toEqual(['model', 'agent'])
  })
  test('moveLayoutItem moves across lines', () => {
    const next = moveLayoutItem(layout(), { line: 0, index: 1 }, { line: 1, index: 0 })
    expect(next.lines[0]).toEqual(['agent'])
    expect(next.lines[1]).toEqual(['model', 'ttft', 'cost'])
  })
  test('moveLayoutItem is a no-op for out-of-range origins', () => {
    expect(moveLayoutItem(layout(), { line: 9, index: 0 }, { line: 0, index: 0 })).toEqual(layout())
  })
  test('moveLayoutItem shifts the target line when the source line empties', () => {
    const five: SessionStatusLayout = { lines: [['agent'], ['ttft'], ['cost'], ['mcp'], ['jobs']], columnGap: 1, rowGap: 0 }
    const next = moveLayoutItem(five, { line: 0, index: 0 }, { line: 4, index: 1 })
    expect(next.lines).toEqual([['ttft'], ['cost'], ['mcp'], ['jobs', 'agent']])
    const mid = moveLayoutItem(five, { line: 0, index: 0 }, { line: 3, index: 0 })
    expect(mid.lines).toEqual([['ttft'], ['cost'], ['agent', 'mcp'], ['jobs']])
  })
  test('insertLayoutItem inserts and clamps the index', () => {
    expect(insertLayoutItem(layout(), { line: 1, index: 1 }, 'cost').lines[1]).toEqual(['ttft', 'cost', 'cost'])
    expect(insertLayoutItem(layout(), { line: 0, index: 99 }, 'cost').lines[0]).toEqual(['agent', 'model', 'cost'])
    expect(insertLayoutItem(layout(), { line: 9, index: 0 }, 'cost')).toEqual(layout())
  })
  test('removeLayoutItem removes and drops empty lines', () => {
    const removed = removeLayoutItem(layout(), { line: 0, index: 0 })
    expect(removed.removed).toBe('agent')
    expect(removed.layout.lines[0]).toEqual(['model'])
    const emptied = removeLayoutItem(layout(), { line: 0, index: 0 }).layout
    const second = removeLayoutItem(emptied, { line: 0, index: 0 })
    expect(second.layout.lines.length).toBe(1)
  })
  test('removeLayoutItem no-ops out of range', () => {
    expect(removeLayoutItem(layout(), { line: 9, index: 0 }).removed).toBeUndefined()
  })
  test('appendLayoutLine respects the line cap', () => {
    let current: SessionStatusLayout = { lines: [], columnGap: 1, rowGap: 0 }
    for (let index = 0; index < MAX_SESSION_LAYOUT_LINES + 2; index += 1) current = appendLayoutLine(current)
    expect(current.lines.length).toBe(MAX_SESSION_LAYOUT_LINES)
  })
  test('removeLayoutLine removes the requested line', () => {
    expect(removeLayoutLine(layout(), 0).lines).toEqual([['ttft', 'cost']])
    expect(removeLayoutLine(layout(), 9)).toEqual(layout())
  })
  test('setLayoutGaps preserves lines and normalizes values', () => {
    const next = setLayoutGaps(layout(), { columnGap: 3, rowGap: 2 })
    expect(next.lines).toEqual(layout().lines)
    expect(next.columnGap).toBe(3)
    expect(next.rowGap).toBe(2)
    expect(setLayoutGaps(layout(), { columnGap: 99 }).columnGap).toBe(MAX_LAYOUT_GAP)
  })
  test('mutations never mutate the input', () => {
    const original = layout()
    moveLayoutItem(original, { line: 0, index: 0 }, { line: 1, index: 0 })
    insertLayoutItem(original, { line: 0, index: 0 }, 'cost')
    removeLayoutItem(original, { line: 0, index: 0 })
    expect(original).toEqual(layout())
  })
  test('item mutations preserve gaps', () => {
    const withGaps = setLayoutGaps(layout(), { columnGap: 2, rowGap: 3 })
    expect(moveLayoutItem(withGaps, { line: 0, index: 0 }, { line: 1, index: 0 }).columnGap).toBe(2)
  })
  test('toLayoutConfig and flattenLayoutLines round-trip', () => {
    const config = toLayoutConfig(['agent', 'cost'])
    expect(config.lines).toEqual([['agent', 'cost']])
    expect(flattenLayoutLines(config)).toEqual(['agent', 'cost'])
    expect(flattenLayoutLines(toLayoutConfig([]))).toEqual([])
  })
})

describe('unused items sink', () => {
  test('unusedStatusItems lists every unplaced id', () => {
    const layout: SessionStatusLayout = { lines: [['agent', 'separator', 'cost']], columnGap: 1, rowGap: 0 }
    const unused = unusedStatusItems(layout)
    expect(unused).toContain('model')
    expect(unused).toContain('mcp')
    expect(unused).not.toContain('agent')
    expect(unused).not.toContain('separator')
  })
  test('unusedHeaderItems excludes placed ids', () => {
    expect(unusedHeaderItems(DEFAULT_SESSION_HEADER_LAYOUT)).toEqual([])
    expect(unusedHeaderItems({ lines: [['workspace']], columnGap: 1, rowGap: 0 })).toEqual(['context', 'notification'])
  })
  test('removal sinks to the unused list and a round trip restores the layout', () => {
    const layout: SessionStatusLayout = { lines: [['agent', 'model']], columnGap: 1, rowGap: 0 }
    const afterRemove = removeLayoutItem(layout, { line: 0, index: 1 })
    expect(afterRemove.removed).toBe('model')
    expect(unusedStatusItems(afterRemove.layout)).toContain('model')
    const restored = insertLayoutItem(afterRemove.layout, { line: 0, index: 1 }, 'model')
    expect(restored).toEqual(layout)
  })
  test('removeLayoutLine returns its items to the unused list', () => {
    const layout: SessionStatusLayout = { lines: [['agent'], ['mcp']], columnGap: 1, rowGap: 0 }
    const afterLineRemove = removeLayoutLine(layout, 1)
    expect(unusedStatusItems(afterLineRemove)).toContain('mcp')
  })
})
