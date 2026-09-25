import { describe, expect, test } from 'bun:test'
import { cyclePermissionMode, DEFAULT_PERMISSION_MODE, normalizeHarness } from '../../src/config/harness-options.ts'

describe('normalizeHarness permissions', () => {
  test('keeps a boolean record map', () => {
    expect(normalizeHarness({ permissions: { shell: true, read: false } }).permissions).toEqual({ shell: true, read: false })
  })
  test('drops non-boolean values', () => {
    expect(normalizeHarness({ permissions: { shell: true, read: 'yes', edit: 1 } }).permissions).toEqual({ shell: true })
  })
  test('throws on an array', () => {
    expect(() => normalizeHarness({ permissions: [{ shell: true }] })).toThrow('permissions')
  })
  test('missing permissions stays undefined', () => {
    expect(normalizeHarness({}).permissions).toBeUndefined()
  })
})

describe('normalizeHarness agent', () => {
  test('keeps a string map', () => {
    expect(normalizeHarness({ agent: { coder: 'flash' } }).agent).toEqual({ coder: 'flash' })
  })
  test('drops empty keys and non-string values', () => {
    expect(normalizeHarness({ agent: { coder: 'flash', '': 'x', other: 1, blank: '  ' } }).agent).toEqual({ coder: 'flash' })
  })
  test('throws on an array', () => {
    expect(() => normalizeHarness({ agent: ['x'] })).toThrow('harness.agent')
  })
})

describe('normalizeHarness budgetLimitUsd', () => {
  test('accepts zero', () => {
    expect(normalizeHarness({ budgetLimitUsd: 0 }).budgetLimitUsd).toBe(0)
  })
  test('accepts a positive number', () => {
    expect(normalizeHarness({ budgetLimitUsd: 12.5 }).budgetLimitUsd).toBe(12.5)
  })
  test('throws on a negative number', () => {
    expect(() => normalizeHarness({ budgetLimitUsd: -1 })).toThrow('budgetLimitUsd')
  })
  test('throws on a non-number', () => {
    expect(() => normalizeHarness({ budgetLimitUsd: 'many' })).toThrow('budgetLimitUsd')
  })
})

describe('normalizeHarness defaultPermissionMode', () => {
  test('accepts yolo and ask', () => {
    expect(normalizeHarness({ defaultPermissionMode: 'yolo' }).defaultPermissionMode).toBe('yolo')
    expect(normalizeHarness({ defaultPermissionMode: 'ask' }).defaultPermissionMode).toBe('ask')
  })
  test('accepts autopilot', () => {
    expect(normalizeHarness({ defaultPermissionMode: 'autopilot' }).defaultPermissionMode).toBe('autopilot')
  })
  test('throws on an unknown mode', () => {
    expect(() => normalizeHarness({ defaultPermissionMode: 'x' })).toThrow('defaultPermissionMode')
  })
  test('defaults to ask mode', () => {
    expect(DEFAULT_PERMISSION_MODE).toBe('ask')
  })
})

describe('cyclePermissionMode', () => {
  test('cycles yolo -> ask -> autopilot -> yolo', () => {
    expect(cyclePermissionMode('yolo')).toBe('ask')
    expect(cyclePermissionMode('ask')).toBe('autopilot')
    expect(cyclePermissionMode('autopilot')).toBe('yolo')
  })
})
