import { describe, expect, test } from 'bun:test'
import { testRender } from '@opentui/solid'
import type { JobRow } from '../../src/agent/sessions/session-jobs.ts'
import type { SessionManager } from '../../src/agent/sessions/session-manager.ts'
import { SpawnView } from '../../src/tui/components/session/tools/spawn-view.tsx'
import type { ToolPartLike } from '../../src/tui/components/session/tools/tool-summary.ts'

const managerWith = (row: JobRow): SessionManager => ({ jobs: () => [row], onJobs: () => () => {} }) as unknown as SessionManager

const part: ToolPartLike = { type: 'tool-spawn', state: 'input-available', input: { subagent: 'explorer' }, output: { sessionId: 'abc' } }

const mount = async (manager: SessionManager, given: ToolPartLike = part) => {
  const setup = await testRender(() => <SpawnView part={given} manager={manager} />, { width: 80, height: 8 })
  await setup.renderOnce()
  await setup.flush()
  return setup
}

describe('SpawnView render', () => {
  test('shows the sub-session title while running', async () => {
    const setup = await mount(managerWith({ sessionId: 'abc', parentId: 'p', subagent: 'explorer', state: 'running', queued: false, startedAt: 1, title: 'Explore the parser' }))
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('EXPLORER')
      expect(frame).toContain('running…')
      expect(frame).toContain('Explore the parser')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('shows the title before the stats line after finishing', async () => {
    const setup = await mount(managerWith({ sessionId: 'abc', parentId: 'p', subagent: 'explorer', state: 'finished', queued: false, startedAt: 1, title: 'Explore the parser' }), {
      ...part,
      state: 'output-available',
      output: { sessionId: 'abc', summary: 'done' },
    })
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('Explore the parser')
      expect(frame.indexOf('Explore the parser')).toBeLessThan(frame.indexOf('· open →'))
    } finally {
      setup.renderer.destroy()
    }
  })
})
