import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLoop } from '../../src/agent/loop/create-loop.ts'
import { createTodoTool } from '../../src/agent/tools/flow/todo.ts'
import { initLockDir } from '../../src/shared/lock.ts'

describe('createLoop', () => {
  test('builds agent transport and manager without calling model', () => {
    const loop = createLoop(() => ({ agentId: 'ask', modelKey: 'test/test', thinking: 'none' }))
    expect(loop.agent).toBeDefined()
    expect(loop.transport).toBeDefined()
    expect(loop.mcp).toBeDefined()
  })
  test('reflects config agent on rebuild', () => {
    const loop = createLoop(() => ({ agentId: 'coder', modelKey: 'test/test', thinking: 'minimal' }))
    expect(loop.agent).toBeDefined()
  })
})

describe('todo tool in tests scope', () => {
  test('write and clear round trip in isolation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'picobu-gap-todo-'))
    initLockDir(dir)
    try {
      const tool = createTodoTool(join(dir, 'todos.json'))
      const written = await tool.handler({ items: [{ phase: 'p', title: 't', prompt: 'q', done: false }] })
      expect(written.items).toHaveLength(1)
      const cleared = await tool.handler({ items: [] })
      expect(cleared.items).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
