import { describe, expect, test } from 'bun:test'
import { testRender } from '@opentui/solid'
import { ShellView } from '../../src/tui/components/session/tools/shell-view.tsx'
import type { ToolPartLike } from '../../src/tui/components/session/tools/tool-summary.ts'

const mount = async (part: ToolPartLike, height = 12) => {
  const setup = await testRender(() => <ShellView part={part} />, { width: 60, height })
  await setup.renderOnce()
  await setup.flush()
  return setup
}

describe('ShellView render', () => {
  test('shows running… and the elapsed time while executing', async () => {
    const setup = await mount({ type: 'tool-shell', state: 'input-available', input: { command: 'echo hi' } })
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('SHELL')
      expect(frame).toContain('running…')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('collapses a finished command to SHELL with the output summary', async () => {
    const setup = await mount({ type: 'tool-shell', state: 'output-available', input: { command: 'echo hi' }, output: 'l1\nl2' })
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('SHELL')
      expect(frame).toContain('2 lines')
      expect(frame).not.toContain('$ echo hi')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('expands to show the command and its output on click', async () => {
    const setup = await mount({ type: 'tool-shell', state: 'output-available', input: { command: 'echo hi' }, output: 'l1\nl2' })
    try {
      await setup.mockMouse.click(3, 0)
      await setup.renderOnce()
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('$ echo hi')
      expect(frame).toContain('l1')
      expect(frame).toContain('l2')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('truncates long output to the expanded line cap', async () => {
    const output = Array.from({ length: 25 }, (_unused, i) => `line ${i + 1}`).join('\n')
    const setup = await mount({ type: 'tool-shell', state: 'output-available', input: { command: 'seq 25' }, output }, 30)
    try {
      await setup.mockMouse.click(3, 0)
      await setup.renderOnce()
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame).toContain('line 1')
      expect(frame).toContain('+5 more')
    } finally {
      setup.renderer.destroy()
    }
  })
})
