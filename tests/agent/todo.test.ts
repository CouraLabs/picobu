import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTodoMessage, createTodoTool, type TodoItem } from '../../src/agent/tools/flow/todo.ts'

const item = (title: string, done = false): TodoItem => ({
  phase: 'test',
  title,
  prompt: `prompt for ${title}`,
  done,
})

describe('createTodoTool', () => {
  let dir: string
  let todoPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-todo-test-'))
    todoPath = join(dir, 'todos.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  afterAll(() => {
    rm(join(tmpdir(), 'picobu-todo-test-'), { recursive: true, force: true })
  })

  const tool = () => createTodoTool(todoPath)

  test('write replaces the whole list and persists it', async () => {
    const result = await tool().handler({ items: [item('a'), item('b')] })
    expect(result.done).toBe(0)
    expect(result.total).toBe(2)
    expect(result.message).toBe('Created 2 todos')
    const onDisk = JSON.parse(await readFile(todoPath, 'utf8'))
    expect(onDisk.items.map((it: TodoItem) => it.title)).toEqual(['a', 'b'])
  })

  test('a second write updates done flags and removes steps without indexes', async () => {
    const t = tool()
    await t.handler({ items: [item('a'), item('b'), item('c')] })
    const result = await t.handler({ items: [item('a'), item('b2', true)] })
    expect(result.done).toBe(1)
    expect(result.total).toBe(2)
    expect(result.message).toBe('Added 1 todo · Removed 2 todos (1 of 2 done)')
  })

  test('completing one step reports which todo finished', async () => {
    const t = tool()
    await t.handler({ items: [item('a'), item('b'), item('c'), item('d'), item('e', true)] })
    const result = await t.handler({ items: [item('a'), item('b', true), item('c'), item('d'), item('e', true)] })
    expect(result.message).toBe('Completed todo 2 of 5')
    expect(result.done).toBe(2)
    expect(result.total).toBe(5)
  })

  test('an empty list clears the todo list', async () => {
    const t = tool()
    await t.handler({ items: [item('a')] })
    const result = await t.handler({ items: [] })
    expect(result.done).toBe(0)
    expect(result.total).toBe(0)
    expect(result.message).toBe('todo list cleared')
    const onDisk = JSON.parse(await readFile(todoPath, 'utf8'))
    expect(onDisk.items).toEqual([])
  })

  test('done is required on every item', () => {
    const parsed = tool().parameters.safeParse({ items: [{ phase: 'test', title: 'a', prompt: 'p' }] })
    expect(parsed.success).toBe(false)
    expect(tool().parameters.safeParse({ items: [{ phase: 'test', title: 'a', prompt: 'p', done: true }] }).success).toBe(true)
  })

  test('a corrupt todo file is reported instead of silently reset', async () => {
    await writeFile(todoPath, 'not json')
    await expect(tool().handler({ items: [item('a')] })).rejects.toThrow(`Corrupt todo file at ${todoPath}`)
  })

  test('a corrupt todo file is rejected even when writing an empty list', async () => {
    await writeFile(todoPath, 'not json')
    await expect(tool().handler({ items: [] })).rejects.toThrow(`Corrupt todo file at ${todoPath}`)
  })

  test('args schema rejects missing or non-array items', () => {
    expect(tool().parameters.safeParse({}).success).toBe(false)
    expect(tool().parameters.safeParse({ items: 'nope' }).success).toBe(false)
    expect(tool().parameters.safeParse({ items: [{ phase: 'p', title: 't', prompt: 'x', done: 'yes' }] }).success).toBe(false)
    expect(tool().parameters.safeParse({ items: [] }).success).toBe(true)
  })

  test('concurrent handlers do not lose writes', async () => {
    const t = tool()
    await Promise.all([t.handler({ items: [item('a')] }), t.handler({ items: [item('a'), item('b')] }), t.handler({ items: [item('a'), item('b'), item('c')] })])
    const result = await t.handler({ items: [item('a'), item('b')] })
    expect(result.total).toBe(2)
    const onDisk = JSON.parse(await readFile(todoPath, 'utf8'))
    expect(onDisk.items).toHaveLength(2)
  })

  test('buildTodoMessage describes diffs without echoing the list', () => {
    expect(buildTodoMessage([], [item('a'), item('b')]).message).toBe('Created 2 todos')
    expect(buildTodoMessage([item('a')], []).message).toBe('todo list cleared')
    expect(buildTodoMessage([item('a')], [item('a', true)]).message).toBe('Completed todo 1 of 1')
    expect(buildTodoMessage([item('a')], [item('a'), item('b')]).message).toBe('Added 1 todo (0 of 2 done)')
  })
})
