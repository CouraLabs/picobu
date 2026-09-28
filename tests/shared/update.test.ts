import { describe, expect, test } from 'bun:test'
import { buildUpdateHelperScript, updateInstallCommand } from '../../src/shared/update.ts'

describe('updateInstallCommand', () => {
  test('is the pinned global install command', () => {
    expect(updateInstallCommand()).toEqual(['bun', 'add', '-g', '@couralabs/picobu', '--force', '--trust'])
  })
})

describe('buildUpdateHelperScript', () => {
  test('carries the pid, session id, install argv and relaunch', () => {
    const script = buildUpdateHelperScript({ sessionId: 'abc123', cwd: '/tmp/work' }, 4242)
    expect(script).toContain('const pid = 4242')
    expect(script).toContain('"abc123"')
    expect(script).toContain('"add","-g","@couralabs/picobu","--force","--trust"')
    expect(script).toContain("['picobu', '--session', sessionId]")
    expect(script).toContain('"/tmp/work"')
  })

  test('omits the session id when the plan has none', () => {
    const script = buildUpdateHelperScript({}, 1)
    expect(script).toContain('const pid = 1')
    expect(script).toContain('const sessionId = null')
    expect(script).toContain("const argv = sessionId ? ['picobu', '--session', sessionId] : ['picobu']")
  })
})
