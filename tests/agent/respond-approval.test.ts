import { beforeEach, describe, expect, test } from 'bun:test'
import { grantPermission, toolNeedsApproval } from '../../src/agent/loop/permissions.ts'
import { mockOptions, mockUpdateSettings, resetMockOptions } from '../helpers/mock-options.ts'

describe('grantPermission', () => {
  test('adds a tool as allowed without dropping existing entries', () => {
    expect(grantPermission({ read: false }, 'shell')).toEqual({ read: false, shell: true })
  })
  test('creates the map from undefined', () => {
    expect(grantPermission(undefined, 'write')).toEqual({ write: true })
  })
})

describe('always allow persists to harness.permissions', () => {
  beforeEach(() => {
    resetMockOptions()
  })
  test('the granted tool no longer needs approval after the write', async () => {
    const next = await mockUpdateSettings({ harness: { permissions: grantPermission(mockOptions.harness.permissions, 'shell') } })
    expect(next.harness.permissions?.shell).toBe(true)
    expect(toolNeedsApproval('shell', next.harness.permissions, 'ask')).toBe(false)
  })
  test('an unrelated tool still asks', async () => {
    const next = await mockUpdateSettings({ harness: { permissions: grantPermission(mockOptions.harness.permissions, 'shell') } })
    expect(toolNeedsApproval('grep', next.harness.permissions, 'ask')).toBe(true)
  })
})
