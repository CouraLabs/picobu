import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLoop } from '../../src/agent/loop/create-loop.ts'
import { createTodoTool } from '../../src/agent/tools/flow/todo.ts'
import { options, type ProviderOptions } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const fakeProvider: ProviderOptions = {
  id: 'test',
  name: 'Test',
  type: 'openai-compatible',
  baseUrl: 'https://example.test/v1',
  apiKey: 'fake-key',
  models: [{ id: 'test', name: 'Test', context: 128000, output: 64000 }],
}

beforeAll(() => {
  if (!options.providers.some((p) => p.id === fakeProvider.id)) options.providers.push(fakeProvider)
})

afterAll(() => {
  const index = options.providers.findIndex((p) => p.id === fakeProvider.id)
  if (index >= 0) options.providers.splice(index, 1)
})

describe('createLoop', () => {
  test('builds agent transport and manager without calling model', () => {
    const loop = createLoop(() => ({ agentId: 'ask', modelKey: 'test/test', thinking: 'none' }))
    expect(loop.agent).toBeDefined()
    expect(loop.transport).toBeDefined()
    expect(loop.mcp).toBeDefined()
    expect(typeof loop.stats).toBe('function')
    expect(typeof loop.onStats).toBe('function')
    expect(loop.stats().usage.inputTokens).toBe(0)
  })
  test('reflects config agent on rebuild', () => {
    const loop = createLoop(() => ({ agentId: 'coder', modelKey: 'test/test', thinking: 'minimal' }))
    expect(loop.agent).toBeDefined()
  })
})

describe('loop endpoint refresh', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    options.statusLine.splice(0, options.statusLine.length)
  })
  test('refreshEndpoints fetches configured endpoints into stats', async () => {
    options.statusLine.push({ provider: 'test', items: [{ type: 'endpoint', label: 'Bal', endpoint: '/credits', value: 'balance' }] })
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ balance: 7 }) }) as unknown as Response) as unknown as typeof fetch
    const loop = createLoop(() => ({ agentId: 'ask', modelKey: 'test/test', thinking: 'none' }))
    loop.refreshEndpoints()
    let stats = loop.stats()
    for (let attempt = 0; attempt < 100 && !stats.endpoints; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      stats = loop.stats()
    }
    expect(stats.endpoints).toEqual({ Bal: { balance: 7 } })
  })
  test('refreshEndpoints skips fetch without endpoint items', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return { ok: true, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch
    const loop = createLoop(() => ({ agentId: 'ask', modelKey: 'test/test', thinking: 'none' }))
    loop.refreshEndpoints()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(called).toBe(false)
    expect(loop.stats().endpoints).toBeUndefined()
  })
})

describe('todo tool in tests scope', () => {
  test('write and clear round trip in isolation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'picobu-gap-todo-'))
    initLockDir(dir)
    try {
      const tool = createTodoTool(join(dir, 'todos.json'))
      const written = await tool.handler({ items: [{ phase: 'p', title: 't', prompt: 'q', done: false }] })
      expect(written.total).toBe(1)
      expect(written.message).toBe('Created 1 todo')
      const cleared = await tool.handler({ items: [] })
      expect(cleared.total).toBe(0)
      expect(cleared.message).toBe('todo list cleared')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
