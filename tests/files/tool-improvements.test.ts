import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobTracker } from '../../src/agent/sessions/session-jobs.ts'
import { spawnSubSession } from '../../src/agent/sessions/session-spawn.ts'
import { createEditTool } from '../../src/agent/tools/filesystem/edit.ts'
import { globTool } from '../../src/agent/tools/filesystem/glob.ts'
import { grepTool } from '../../src/agent/tools/filesystem/grep.ts'
import { readTool } from '../../src/agent/tools/filesystem/read.ts'
import { createShellTool } from '../../src/agent/tools/filesystem/shell.ts'
import { createWriteTool } from '../../src/agent/tools/filesystem/write.ts'
import { createSpawnTool, SpawnToolArgsSchema } from '../../src/agent/tools/flow/spawn.ts'
import { createTodoTool, normalizeTodoItem } from '../../src/agent/tools/flow/todo.ts'
import { headText, spillToolResult, tailText, truncateTextWithSpill, writeFullToolOutput } from '../../src/agent/tools/truncate-output.ts'
import { extractTextFromHtml } from '../../src/agent/tools/web/html-to-markdown.ts'
import { WebfetchToolArgsSchema } from '../../src/agent/tools/web/webfetch.ts'
import { WebsearchToolArgsSchema } from '../../src/agent/tools/web/websearch.ts'
import { options } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'
import { shellErrorLabel } from '../../src/tui/components/session/tools/tool-summary.ts'

const originalSystemDir = options.app.systemDir
const originalCwd = process.cwd()
let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'picobu-improve-'))
  initLockDir(join(dir, 'locks'))
  process.chdir(dir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  options.app.systemDir = originalSystemDir
  await rm(dir, { recursive: true, force: true })
})

describe('edit fuzzy matching', () => {
  test('tolerates indentation differences', async () => {
    await createWriteTool().handler({ path: 'f.txt', contents: 'if (x) {\n    doThing()\n}' })
    const res = await createEditTool().handler({ path: 'f.txt', oldString: 'if (x) {\n  doThing()\n}', newString: 'if (x) {\n  doOther()\n}' })
    expect(res.message).toContain('Replaced')
    const back = await readTool.handler({ path: 'f.txt' })
    expect(back.content).toContain('doOther()')
  })
  test('replaceAll rewrites every occurrence', async () => {
    await createWriteTool().handler({ path: 'm.txt', contents: 'foo one foo two foo' })
    await createEditTool().handler({ path: 'm.txt', oldString: 'foo', newString: 'bar', replaceAll: true })
    const back = await readTool.handler({ path: 'm.txt' })
    expect(back.content).toBe('bar one bar two bar')
  })
  test('empty oldString creates a missing file', async () => {
    const res = await createEditTool().handler({ path: 'new.txt', oldString: '', newString: 'created' })
    expect(res.diff).toContain('+created')
    expect(await Bun.file(join(dir, 'new.txt')).text()).toBe('created')
  })
  test('empty oldString on existing file errors', async () => {
    await createWriteTool().handler({ path: 'e.txt', contents: 'x' })
    await expect(createEditTool().handler({ path: 'e.txt', oldString: '', newString: 'y' })).rejects.toThrow('cannot be empty')
  })
  test('identical old and new strings error', async () => {
    await createWriteTool().handler({ path: 's.txt', contents: 'same' })
    await expect(createEditTool().handler({ path: 's.txt', oldString: 'same', newString: 'same' })).rejects.toThrow('identical')
  })
  test('preserves CRLF line endings', async () => {
    await Bun.write(join(dir, 'crlf.txt'), 'a\r\nb\r\n')
    await createEditTool().handler({ path: 'crlf.txt', oldString: 'a', newString: 'z' })
    expect(await Bun.file(join(dir, 'crlf.txt')).text()).toBe('z\r\nb\r\n')
  })
})

describe('write BOM preservation', () => {
  test('keeps an existing BOM', async () => {
    await Bun.write(join(dir, 'bom.txt'), '﻿hello')
    await createWriteTool().handler({ path: 'bom.txt', contents: 'world' })
    const bytes = new Uint8Array(await Bun.file(join(dir, 'bom.txt')).arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('world')
  })
  test('write output carries a diff', async () => {
    const out = await createWriteTool().handler({ path: 'd.txt', contents: 'one' })
    expect(out.diff).toContain('+one')
  })
  test('write result preview truncates by lines, not characters', async () => {
    const longLine = 'x'.repeat(20_000)
    const under = await createWriteTool().handler({ path: 'u.txt', contents: `a\n${longLine}` })
    expect(under.content).toBe(`a\n${longLine}`)
    const manyLines = Array.from({ length: 600 }, (_, i) => `line ${i}`)
    const over = await createWriteTool().handler({ path: 'o.txt', contents: manyLines.join('\n') })
    expect(over.content).toBe(`${manyLines.slice(0, 500).join('\n')}\n…[truncated]`)
    expect(await Bun.file(join(dir, 'o.txt')).text()).toBe(manyLines.join('\n'))
  })
})

describe('read upgrades', () => {
  test('lists directories with pagination', async () => {
    await mkdir(join(dir, 'listed'), { recursive: true })
    await Bun.write(join(dir, 'listed', 'b.txt'), 'b')
    await Bun.write(join(dir, 'listed', 'a.txt'), 'a')
    const all = await readTool.handler({ path: 'listed' })
    expect(all.filetype).toBe('directory')
    expect(all.content).toContain('a.txt')
    const page = await readTool.handler({ path: 'listed', skip: 1, limit: 1 })
    expect(page.content).toContain('b.txt')
    expect(page.content).not.toContain('a.txt')
  })
  test('rejects binary files', async () => {
    await Bun.write(join(dir, 'blob.bin'), new Uint8Array([0, 1, 2, 3, 4, 5]))
    await expect(readTool.handler({ path: 'blob.bin' })).rejects.toThrow('binary')
  })
  test('images return metadata instead of bytes', async () => {
    await Bun.write(join(dir, 'pic.png'), new Uint8Array([137, 80, 78, 71]))
    const got = await readTool.handler({ path: 'pic.png' })
    expect(got.content).toContain('Image')
  })
  test('missing file suggests similar names', async () => {
    await Bun.write(join(dir, 'app-config.ts'), 'x')
    await expect(readTool.handler({ path: 'config.ts' })).rejects.toThrow('Did you mean')
  })
  test('long lines are cut with a suffix', async () => {
    await Bun.write(join(dir, 'long.txt'), `ok\n${'y'.repeat(3000)}`)
    const got = await readTool.handler({ path: 'long.txt' })
    expect(got.content).toContain('line truncated to 2000 chars')
  })
  test('out of range skip errors', async () => {
    await Bun.write(join(dir, 'small.txt'), 'one\ntwo')
    await expect(readTool.handler({ path: 'small.txt', skip: 99 })).rejects.toThrow('out of range')
  })
})

describe('grep include and glob validation', () => {
  test('grep include filters by file glob', async () => {
    await Bun.write(join(dir, 'keep.ts'), 'needle here')
    await Bun.write(join(dir, 'skip.md'), 'needle here')
    const res = await grepTool.handler({ pattern: 'needle', path: '.', include: '*.ts' })
    expect(res.content).toContain('keep.ts')
    expect(res.content).not.toContain('skip.md')
  })
  test('glob rejects file paths', async () => {
    await Bun.write(join(dir, 'plain.txt'), 'x')
    await expect(globTool.handler({ pattern: '**/*.txt', path: 'plain.txt' })).rejects.toThrow('must be a directory')
  })
})

describe('shell spill and metadata', () => {
  test('failure output carries exit metadata', async () => {
    const shell = createShellTool()
    const collect = async () => {
      for await (const chunk of shell.handler({ command: 'echo out-line; echo err-line >&2; exit 3' })) void chunk
    }
    try {
      await collect()
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('exited 3')
      expect(message).toContain('out-line')
      expect(message).toContain('<shell_metadata>')
      expect(shellErrorLabel(message)).toBe('errored · exit 3')
    }
  })
  test('timeout error names the timeout', async () => {
    const shell = createShellTool()
    const collect = async () => {
      for await (const chunk of shell.handler({ command: 'sleep 5', timeout: 1 })) void chunk
    }
    await expect(collect()).rejects.toThrow('timed out after 1s')
  })
})

describe('todo priority and done', () => {
  test('done false is not counted done and priority is persisted', async () => {
    const tool = createTodoTool(join(dir, 'todos.json'))
    const result = await tool.handler({ items: [{ phase: 'p', title: 'a', prompt: 'x', priority: 'high', done: false }] })
    expect(result.done).toBe(0)
    expect(result.total).toBe(1)
    const onDisk = JSON.parse(await readFile(join(dir, 'todos.json'), 'utf8'))
    expect(onDisk.items[0].done).toBe(false)
    expect(onDisk.items[0].priority).toBe('high')
  })
  test('legacy files still read', async () => {
    await Bun.write(join(dir, 'legacy.json'), JSON.stringify({ items: [{ phase: 'p', title: 'a', prompt: 'x', done: true }] }))
    const tool = createTodoTool(join(dir, 'legacy.json'))
    const result = await tool.handler({ items: [{ phase: 'p', title: 'a', prompt: 'x', done: true }] })
    expect(result.done).toBe(1)
    expect(normalizeTodoItem({ phase: 'p', title: 'a', prompt: 'x', done: true }).done).toBe(true)
  })
})

describe('spawn args', () => {
  test('schema accepts description and taskId', () => {
    expect(SpawnToolArgsSchema.safeParse({ subagent: 'explorer', prompt: 'go', description: 'map repo', taskId: 'abc' }).success).toBe(true)
    expect(SpawnToolArgsSchema.safeParse({ subagent: 'explorer', prompt: 'go' }).success).toBe(true)
  })
  test('handler forwards description and taskId', async () => {
    let seen: Record<string, unknown> = {}
    const fake = {
      spawnSubSession: async (input: Record<string, unknown>) => {
        seen = input
        return { summary: 'ok' }
      },
    }
    const tool = createSpawnTool({ manager: fake as never, parentId: 'p', depth: 0 })
    for await (const output of tool.handler({ subagent: 'explorer', prompt: 'go', description: 'map repo', taskId: 'abc' })) void output
    expect(seen).toMatchObject({ description: 'map repo', taskId: 'abc' })
  })
  test('unknown taskId fails fast', async () => {
    const jobs = new JobTracker()
    await expect(
      spawnSubSession(
        { manager: {} as never, cwd: dir, maxAgents: 4, live: new Map(), jobs, baseConfig: () => ({}) as never },
        { parentId: 'p', subagent: 'explorer', prompt: 'go', depth: 0, taskId: 'nope' },
      ),
    ).rejects.toThrow('Unknown taskId')
  })
})

describe('truncate service', () => {
  test('tailText keeps the tail within limits', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n')
    const tail = tailText(text, 100, 100_000)
    expect(tail.cut).toBe(true)
    expect(tail.text).toContain('line 2999')
    expect(tail.text).not.toContain('line 0\n')
  })
  test('headText keeps the head within limits', () => {
    const tail = headText('a\nb\nc\nd', 2, 100_000)
    expect(tail.cut).toBe(true)
    expect(tail.text).toBe('a\nb')
  })
  test('spill writes the full text and hints at the path', async () => {
    options.app.systemDir = join(dir, 'sys')
    const big = `${'x'.repeat(60_000)}`
    const spilled = await truncateTextWithSpill(big)
    expect(spilled.truncated).toBe(true)
    expect(spilled.outputPath).toBeDefined()
    expect(await readFile(spilled.outputPath as string, 'utf8')).toBe(big)
    expect(spilled.text).toContain('Full output saved to:')
    await rm(join(dir, 'sys'), { recursive: true, force: true })
  })
  test('writeFullToolOutput round trips', async () => {
    options.app.systemDir = join(dir, 'sys2')
    const path = await writeFullToolOutput('hello spill')
    expect(await readFile(path, 'utf8')).toBe('hello spill')
    await rm(join(dir, 'sys2'), { recursive: true, force: true })
  })
  test('spillToolResult handles strings and content objects', async () => {
    options.app.systemDir = join(dir, 'sys3')
    const big = `v\n${'w'.repeat(60_000)}`
    const str = (await spillToolResult(big)) as string
    expect(str).toContain('Full output saved to:')
    const obj = (await spillToolResult({ filetype: 'text', content: big })) as { content: string }
    expect(obj.content).toContain('Full output saved to:')
    expect(await spillToolResult('short')).toBe('short')
    await rm(join(dir, 'sys3'), { recursive: true, force: true })
  })
})

describe('web schemas and text extraction', () => {
  test('webfetch schema accepts format timeout and browser flag', () => {
    expect(WebfetchToolArgsSchema.safeParse({ url: 'https://example.com' }).data?.format).toBe('markdown')
    expect(WebfetchToolArgsSchema.safeParse({ url: 'https://example.com', format: 'text', timeout: 60, useBrowser: true }).success).toBe(true)
    expect(WebfetchToolArgsSchema.safeParse({ url: 'https://example.com', format: 'pdf' }).success).toBe(false)
    expect(WebfetchToolArgsSchema.safeParse({ url: 'https://example.com', timeout: 121 }).success).toBe(false)
  })
  test('websearch schema caps results and toggles fetch', () => {
    expect(WebsearchToolArgsSchema.safeParse({ query: 'hi' }).data?.numResults).toBeUndefined()
    expect(WebsearchToolArgsSchema.safeParse({ query: 'hi', numResults: 5, fetchContent: false }).success).toBe(true)
    expect(WebsearchToolArgsSchema.safeParse({ query: 'hi', numResults: 21 }).success).toBe(false)
  })
  test('extractTextFromHtml strips tags and skips embeds', () => {
    expect(extractTextFromHtml('<p>hello <b>world</b></p><script>evil()</script>')).toBe('hello world')
  })
})
