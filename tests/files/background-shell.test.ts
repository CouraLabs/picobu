import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBackgroundShell, listBackgroundShells, onBackgroundShells, startBackgroundShell, stopAllBackgroundShells, stopBackgroundShell } from '../../src/agent/tools/filesystem/background-shell.ts'
import { createTaskOutputTool, createTaskStopTool } from '../../src/agent/tools/filesystem/task-tools.ts'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'picobu-bgshell-'))
})

afterAll(async () => {
  await stopAllBackgroundShells().catch(() => {})
  await rm(dir, { recursive: true, force: true })
})

describe('background shell registry', () => {
  test('echo completes with exit 0 and captures output', async () => {
    const entry = startBackgroundShell({ command: 'echo hello-bg', cwd: dir })
    expect(entry.status).toBe('running')
    const status = await entry.done
    expect(status).toBe('completed')
    const done = getBackgroundShell(entry.id)
    expect(done?.exitCode).toBe(0)
    expect(done?.tail).toContain('hello-bg')
    const log = await readFile(entry.logFile, 'utf8')
    expect(log).toContain('hello-bg')
  })

  test('stopBackgroundShell kills a running sleep', async () => {
    const entry = startBackgroundShell({ command: 'sleep 30', cwd: dir })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const stopped = await stopBackgroundShell(entry.id)
    expect(stopped?.status).toBe('stopped')
    expect(getBackgroundShell(entry.id)?.status).toBe('stopped')
  })

  test('listener emits on start and completion', async () => {
    const events: Array<number> = []
    const off = onBackgroundShells((entries) => events.push(entries.length))
    const entry = startBackgroundShell({ command: 'true', cwd: dir })
    await entry.done
    off()
    expect(events.length).toBeGreaterThanOrEqual(2)
  })

  test('stopAllBackgroundShells clears every running task', async () => {
    const a = startBackgroundShell({ command: 'sleep 30', cwd: dir })
    const b = startBackgroundShell({ command: 'sleep 30', cwd: dir })
    await stopAllBackgroundShells()
    expect(getBackgroundShell(a.id)?.status).toBe('stopped')
    expect(getBackgroundShell(b.id)?.status).toBe('stopped')
    expect(listBackgroundShells().every((entry) => entry.status !== 'running')).toBe(true)
  })
})

describe('task tools', () => {
  test('task_output blocks until completion', async () => {
    const tool = createTaskOutputTool()
    const entry = startBackgroundShell({ command: 'echo task-done', cwd: dir })
    const result = await tool.handler({ taskId: entry.id })
    expect(result.status).toBe('completed')
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('task-done')
  })

  test('task_output reports unknown ids', async () => {
    const tool = createTaskOutputTool()
    const result = await tool.handler({ taskId: 'bg_missing' })
    expect(result.status).toBe('unknown')
  })

  test('task_stop stops a running task', async () => {
    const stop = createTaskStopTool()
    const entry = startBackgroundShell({ command: 'sleep 30', cwd: dir })
    const result = await stop.handler({ taskId: entry.id })
    expect(result.status).toBe('stopped')
  })

  test('task_stop reports unknown ids', async () => {
    const stop = createTaskStopTool()
    const result = await stop.handler({ taskId: 'bg_missing' })
    expect(result.status).toBe('unknown')
  })

  test('background shell is gated to interactive (non-subagent) sessions', async () => {
    const { createShellTool } = await import('../../src/agent/tools/filesystem/shell.ts')
    const { buildToolSet } = await import('../../src/agent/tools/toolset.ts')
    const subagentShell = createShellTool({ allowBackground: false })
    expect('run_in_background' in subagentShell.parameters.shape).toBe(false)
    const interactiveShell = createShellTool({ allowBackground: true })
    expect('run_in_background' in interactiveShell.parameters.shape).toBe(true)
    const subagentTools = buildToolSet({ interactive: false })
      .getTools()
      .map((tool) => tool.name)
    expect(subagentTools).toContain('shell')
    expect(subagentTools).not.toContain('task_output')
    expect(subagentTools).not.toContain('task_stop')
    const interactiveTools = buildToolSet({ interactive: true })
      .getTools()
      .map((tool) => tool.name)
    expect(interactiveTools).toContain('task_output')
    expect(interactiveTools).toContain('task_stop')
  })
})
