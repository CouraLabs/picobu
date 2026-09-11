import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTodoTool, type TodoItem } from '../../src/agent/tools/flow/todo.ts'

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
    expect(result.items).toHaveLength(2)
    expect(result.message).toBe('0 of 2 done')
    const onDisk = JSON.parse(await readFile(todoPath, 'utf8'))
    expect(onDisk.items).toEqual(result.items)
  })

  test('a second write updates done flags and removes steps without indexes', async () => {
    const t = tool()
    await t.handler({ items: [item('a'), item('b'), item('c')] })
    const result = await t.handler({ items: [item('a'), item('b2', true)] })
    expect(result.items.map((it) => it.title)).toEqual(['a', 'b2'])
    expect(result.items[1]?.done).toBe(true)
    expect(result.message).toBe('1 of 2 done')
  })

  test('the first write creates the list', async () => {
    const result = await tool().handler({ items: [item('first')] })
    expect(result.items).toHaveLength(1)
  })

  test('an empty list clears the todo list', async () => {
    const t = tool()
    await t.handler({ items: [item('a')] })
    const result = await t.handler({ items: [] })
    expect(result.items).toHaveLength(0)
    expect(result.message).toBe('todo list cleared')
    const onDisk = JSON.parse(await readFile(todoPath, 'utf8'))
    expect(onDisk.items).toEqual([])
  })

  test('omitted done defaults to false through the args schema', () => {
    const parsed = tool().parameters.parse({ items: [{ phase: 'test', title: 'a', prompt: 'p' }] })
    expect(parsed.items[0]?.done).toBe(false)
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
    expect(result.items).toHaveLength(2)
    const onDisk = JSON.parse(await readFile(todoPath, 'utf8'))
    expect(onDisk.items).toHaveLength(2)
  })
})
