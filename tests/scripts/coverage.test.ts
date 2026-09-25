import { describe, expect, test } from 'bun:test'
import { COVERAGE_THRESHOLD, parseLcov, shouldFail } from '../../scripts/coverage.ts'

describe('parseLcov', () => {
  test('counts lines and hits from DA records', () => {
    const lcov = ['SF:src/a.ts', 'DA:1,3', 'DA:2,0', 'DA:3,5', 'end_of_record'].join('\n')
    const summary = parseLcov(lcov)
    expect(summary.lines).toBe(3)
    expect(summary.hit).toBe(2)
    expect(summary.percent).toBeCloseTo(66.666, 2)
  })
  test('ignores other lcov records', () => {
    const summary = parseLcov(['SF:src/a.ts', 'FNF:1', 'FNH:0', 'LF:2', 'LH:1'].join('\n'))
    expect(summary.lines).toBe(0)
    expect(summary.percent).toBe(100)
  })
  test('treats a fully covered file as 100%', () => {
    expect(parseLcov(['DA:1,1', 'DA:2,4'].join('\n')).percent).toBe(100)
  })
})

describe('shouldFail', () => {
  test('fails below the threshold', () => {
    expect(shouldFail(COVERAGE_THRESHOLD - 0.1)).toBe(true)
  })
  test('passes at or above the threshold', () => {
    expect(shouldFail(COVERAGE_THRESHOLD)).toBe(false)
    expect(shouldFail(95)).toBe(false)
  })
})
