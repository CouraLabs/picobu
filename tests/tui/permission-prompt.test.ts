import { describe, expect, test } from 'bun:test'
import { permissionPreview } from '../../src/tui/components/session/tools/tool-summary.ts'
import { isPermissionModeKey } from '../../src/tui/keybindings.ts'

describe('permissionPreview', () => {
  test('shell shows the command', () => {
    expect(permissionPreview('shell', { command: 'rm -rf dist' })).toContain('rm -rf dist')
  })
  test('read shows the path', () => {
    expect(permissionPreview('read', { path: 'src/cli.ts' })).toContain('src/cli.ts')
  })
  test('edit shows the path and the diff lines', () => {
    const out = permissionPreview('edit', { path: 'a.ts', oldString: 'foo', newString: 'bar' })
    expect(out).toContain('a.ts')
    expect(out).toContain('foo')
    expect(out).toContain('bar')
  })
  test('write shows the path and a content preview', () => {
    const out = permissionPreview('write', { path: 'b.ts', contents: 'line one\nline two' })
    expect(out).toContain('b.ts')
    expect(out).toContain('line one')
  })
  test('unknown tool falls back to JSON', () => {
    expect(permissionPreview('mcp_demo_echo', { message: 'hi' })).toContain('hi')
  })
})

describe('isPermissionModeKey', () => {
  test('matches ctrl+p', () => {
    expect(isPermissionModeKey({ name: 'p', ctrl: true, meta: false }, 'linux')).toBe(true)
  })
  test('does not match a bare p', () => {
    expect(isPermissionModeKey({ name: 'p', ctrl: false, meta: false }, 'linux')).toBe(false)
  })
  test('does not match another ctrl letter', () => {
    expect(isPermissionModeKey({ name: 'k', ctrl: true, meta: false }, 'linux')).toBe(false)
  })
})
