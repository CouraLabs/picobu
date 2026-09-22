import { describe, expect, test } from 'bun:test'
import { collapseHome } from '../../src/shared/path.ts'

describe('collapseHome', () => {
  test('collapses the home prefix to ~', () => expect(collapseHome('/Users/rodcoura/Projects/picobu', '/Users/rodcoura')).toBe('~/Projects/picobu'))
  test('collapses the home dir itself', () => expect(collapseHome('/Users/rodcoura', '/Users/rodcoura')).toBe('~'))
  test('leaves unrelated paths untouched', () => expect(collapseHome('/tmp/x', '/Users/rodcoura')).toBe('/tmp/x'))
  test('tolerates a trailing slash on home', () => expect(collapseHome('/home/u/a', '/home/u/')).toBe('~/a'))
  test('does not match a sibling prefix', () => expect(collapseHome('/Users/rodcouraX', '/Users/rodcoura')).toBe('/Users/rodcouraX'))
  test('empty home is a no-op', () => expect(collapseHome('/a/b', '')).toBe('/a/b'))
})
