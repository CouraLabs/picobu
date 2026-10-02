import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoopMessage } from '../../src/agent/loop/create-loop.ts'
import { createSession } from '../../src/agent/sessions/session.ts'
import { SessionManager } from '../../src/agent/sessions/session-manager.ts'
import { DEFAULT_PERMISSION_MODE } from '../../src/config/harness-options.ts'
import { options } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const originalSystemDir = options.app.systemDir

async function useTempSystem(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  options.app.systemDir = dir
  initLockDir(dir)
  return dir
}

const userMessage = (id: string, text: string): LoopMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] }) as unknown as LoopMessage

const assistantMessage = (id: string, text: string): LoopMessage => ({ id, role: 'assistant', parts: [{ type: 'text', text }] }) as unknown as LoopMessage

describe('SessionManager.changeDirectory', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await useTempSystem('picobu-cd-')
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
  })

  test('forwards onChange to the new session and moves the cwd', async () => {
    const target = join(dir, 'next')
    await mkdir(target, { recursive: true })
    const manager = new SessionManager({ cwd: dir })
    const captured: Array<unknown> = []
    const original = manager.startSession.bind(manager)
    manager.startSession = (init = {}) => {
      captured.push(init.onChange)
      return original(init)
    }
    const handler = () => {}
    const fresh = await manager.changeDirectory(target, { onChange: handler })
    expect(manager.currentCwd).toBe(target)
    expect(fresh).toBeDefined()
    expect(captured).toEqual([handler])
    await fresh?.close()
    manager.dispose()
  })

  test('returns undefined without creating a session for the current folder', async () => {
    const manager = new SessionManager({ cwd: dir })
    expect(await manager.changeDirectory(dir)).toBeUndefined()
    expect(manager.currentCwd).toBe(dir)
    manager.dispose()
  })

  test('a session from changeDirectory reports prompts back to onChange', async () => {
    const target = join(dir, 'next')
    await mkdir(target, { recursive: true })
    const manager = new SessionManager({ cwd: dir })
    const seen: Array<Array<string>> = []
    const fresh = await manager.changeDirectory(target, { onChange: (state) => seen.push(state.messages.map((m) => m.role)) })
    if (!fresh) throw new Error('changeDirectory returned no session')
    await fresh.sendMessage({ parts: [{ type: 'text', text: 'hello' }] }).catch(() => {})
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toContain('user')
    await fresh.close()
    await Bun.sleep(50)
    manager.dispose()
  })

  test('a session created with onChange notifies on state changes', async () => {
    const seen: Array<number> = []
    const session = await createSession({
      id: 'onchange-probe',
      config: () => ({ agentId: 'coder', modelKey: 'anthropic/claude-haiku', thinking: 'medium', cwd: dir, permissionMode: DEFAULT_PERMISSION_MODE }),
      messages: [userMessage('u1', 'hi'), assistantMessage('a1', 'hello')],
      onChange: (state) => seen.push(state.messages.length),
    })
    expect(seen).toEqual([])
    session.revertToMessage('u1')
    expect(seen).toEqual([0])
    await session.close()
    await Bun.sleep(50)
  })
})
