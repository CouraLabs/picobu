import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JobTracker } from '../../src/agent/sessions/session-jobs.ts'
import { spawnSubSession } from '../../src/agent/sessions/session-spawn.ts'
import { createApplyPatchTool } from '../../src/agent/tools/filesystem/apply-patch.ts'
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

const sb = (dir: string) => ({ root: dir }) as never
const originalSystemDir = options.app.systemDir
let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'picobu-improve-'))
  initLockDir(join(dir, 'locks'))
})

afterEach(async () => {
  options.app.systemDir = originalSystemDir
  await rm(dir, { recursive: true, force: true })
})

describe('edit fuzzy matching', () => {
  test('tolerates indentation differences', async () => {
    await createWriteTool().handler({ path: 'f.txt', contents: 'if (x) {\n    doThing()\n}' }, { experimental_sandbox: sb(dir) })
    const res = await createEditTool().handler({ path: 'f.txt', oldString: 'if (x) {\n  doThing()\n}', newString: 'if (x) {\n  doOther()\n}' }, { experimental_sandbox: sb(dir) })
    expect(res.message).toContain('Replaced')
    const back = await readTool.handler({ path: 'f.txt' }, { experimental_sandbox: sb(dir) })
    expect(back.content).toContain('doOther()')
  })
  test('replaceAll rewrites every occurrence', async () => {
    await createWriteTool().handler({ path: 'm.txt', contents: 'foo one foo two foo' }, { experimental_sandbox: sb(dir) })
    await createEditTool().handler({ path: 'm.txt', oldString: 'foo', newString: 'bar', replaceAll: true }, { experimental_sandbox: sb(dir) })
    const back = await readTool.handler({ path: 'm.txt' }, { experimental_sandbox: sb(dir) })
    expect(back.content).toBe('bar one bar two bar')
  })
  test('empty oldString creates a missing file', async () => {
    const res = await createEditTool().handler({ path: 'new.txt', oldString: '', newString: 'created' }, { experimental_sandbox: sb(dir) })
    expect(res.diff).toContain('+created')
    expect(await Bun.file(join(dir, 'new.txt')).text()).toBe('created')
  })
  test('empty oldString on existing file errors', async () => {
    await createWriteTool().handler({ path: 'e.txt', contents: 'x' }, { experimental_sandbox: sb(dir) })
    await expect(createEditTool().handler({ path: 'e.txt', oldString: '', newString: 'y' }, { experimental_sandbox: sb(dir) })).rejects.toThrow('cannot be empty')
  })
  test('identical old and new strings error', async () => {
    await createWriteTool().handler({ path: 's.txt', contents: 'same' }, { experimental_sandbox: sb(dir) })
    await expect(createEditTool().handler({ path: 's.txt', oldString: 'same', newString: 'same' }, { experimental_sandbox: sb(dir) })).rejects.toThrow('identical')
  })
  test('preserves CRLF line endings', async () => {
    await Bun.write(join(dir, 'crlf.txt'), 'a\r\nb\r\n')
    await createEditTool().handler({ path: 'crlf.txt', oldString: 'a', newString: 'z' }, { experimental_sandbox: sb(dir) })
    expect(await Bun.file(join(dir, 'crlf.txt')).text()).toBe('z\r\nb\r\n')
  })
})

describe('write BOM preservation', () => {
  test('keeps an existing BOM', async () => {
    await Bun.write(join(dir, 'bom.txt'), '﻿hello')
    await createWriteTool().handler({ path: 'bom.txt', contents: 'world' }, { experimental_sandbox: sb(dir) })
    const bytes = new Uint8Array(await Bun.file(join(dir, 'bom.txt')).arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('world')
  })
  test('write output carries a diff', async () => {
    const out = await createWriteTool().handler({ path: 'd.txt', contents: 'one' }, { experimental_sandbox: sb(dir) })
    expect(out.diff).toContain('+one')
  })
})

describe('read upgrades', () => {
  test('lists directories with pagination', async () => {
    await mkdir(join(dir, 'listed'), { recursive: true })
    await Bun.write(join(dir, 'listed', 'b.txt'), 'b')
    await Bun.write(join(dir, 'listed', 'a.txt'), 'a')
    const all = await readTool.handler({ path: 'listed' }, { experimental_sandbox: sb(dir) })
    expect(all.filetype).toBe('directory')
    expect(all.content).toContain('a.txt')
    const page = await readTool.handler({ path: 'listed', skip: 1, limit: 1 }, { experimental_sandbox: sb(dir) })
    expect(page.content).toContain('b.txt')
    expect(page.content).not.toContain('a.txt')
  })
  test('rejects binary files', async () => {
    await Bun.write(join(dir, 'blob.bin'), new Uint8Array([0, 1, 2, 3, 4, 5]))
    await expect(readTool.handler({ path: 'blob.bin' }, { experimental_sandbox: sb(dir) })).rejects.toThrow('binary')
  })
  test('images return metadata instead of bytes', async () => {
    await Bun.write(join(dir, 'pic.png'), new Uint8Array([137, 80, 78, 71]))
    const got = await readTool.handler({ path: 'pic.png' }, { experimental_sandbox: sb(dir) })
    expect(got.content).toContain('Image')
  })
  test('missing file suggests similar names', async () => {
    await Bun.write(join(dir, 'app-config.ts'), 'x')
    await expect(readTool.handler({ path: 'config.ts' }, { experimental_sandbox: sb(dir) })).rejects.toThrow('Did you mean')
  })
  test('long lines are cut with a suffix', async () => {
    await Bun.write(join(dir, 'long.txt'), `ok\n${'y'.repeat(3000)}`)
    const got = await readTool.handler({ path: 'long.txt' }, { experimental_sandbox: sb(dir) })
    expect(got.content).toContain('line truncated to 2000 chars')
  })
  test('out of range skip errors', async () => {
    await Bun.write(join(dir, 'small.txt'), 'one\ntwo')
    await expect(readTool.handler({ path: 'small.txt', skip: 99 }, { experimental_sandbox: sb(dir) })).rejects.toThrow('out of range')
  })
})

describe('grep include and glob validation', () => {
  test('grep include filters by file glob', async () => {
    await Bun.write(join(dir, 'keep.ts'), 'needle here')
    await Bun.write(join(dir, 'skip.md'), 'needle here')
    const res = await grepTool.handler({ pattern: 'needle', include: '*.ts' }, { experimental_sandbox: sb(dir) })
    expect(res.content).toContain('keep.ts')
    expect(res.content).not.toContain('skip.md')
  })
  test('glob rejects file paths', async () => {
    await Bun.write(join(dir, 'plain.txt'), 'x')
    await expect(globTool.handler({ pattern: '**/*.txt', cwd: 'plain.txt' }, { experimental_sandbox: sb(dir) })).rejects.toThrow('must be a directory')
  })
})

describe('shell spill and metadata', () => {
  test('failure output carries exit metadata', async () => {
    const { createLocalSandboxSession } = await import('../../src/agent/tools/sandbox.ts')
    const session = createLocalSandboxSession(dir, 'Unix:Sh')
    const shell = createShellTool()
    const collect = async () => {
      for await (const chunk of shell.handler({ command: 'echo out-line; echo err-line >&2; exit 3' }, { experimental_sandbox: session as never })) void chunk
    }
    try {
      await collect()
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('exited 3')
      expect(message).toContain('out-line')
      expect(message).toContain('<shell_metadata>')
    }
  })
  test('timeout error names the timeout', async () => {
    const { createLocalSandboxSession } = await import('../../src/agent/tools/sandbox.ts')
    const session = createLocalSandboxSession(dir, 'Unix:Sh')
    const shell = createShellTool()
    const collect = async () => {
      for await (const chunk of shell.handler({ command: 'sleep 5', timeout: 1 }, { experimental_sandbox: session as never })) void chunk
    }
    await expect(collect()).rejects.toThrow('timed out after 1s')
  })
})

describe('todo status and priority', () => {
  test('in_progress is not counted done', async () => {
    const tool = createTodoTool(join(dir, 'todos.json'))
    const result = await tool.handler({ items: [{ phase: 'p', title: 'a', prompt: 'x', status: 'in_progress', priority: 'high', done: false }] })
    expect(result.done).toBe(0)
    expect(result.total).toBe(1)
    const onDisk = JSON.parse(await readFile(join(dir, 'todos.json'), 'utf8'))
    expect(onDisk.items[0].status).toBe('in_progress')
    expect(onDisk.items[0].priority).toBe('high')
  })
  test('legacy done files migrate to status', async () => {
    await Bun.write(join(dir, 'legacy.json'), JSON.stringify({ items: [{ phase: 'p', title: 'a', prompt: 'x', done: true }] }))
    const tool = createTodoTool(join(dir, 'legacy.json'))
    const result = await tool.handler({ items: [{ phase: 'p', title: 'a', prompt: 'x', done: true }] })
    expect(result.done).toBe(1)
    expect(normalizeTodoItem({ phase: 'p', title: 'a', prompt: 'x', done: true }).status).toBe('completed')
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

describe('apply_patch', () => {
  test('updates a file via unified diff', async () => {
    await Bun.write(join(dir, 'target.txt'), 'line1\nline2\nline3\n')
    const tool = createApplyPatchTool()
    const patch = '--- a/target.txt\n+++ b/target.txt\n@@ -1,3 +1,3 @@\n line1\n-line2\n+LINE2\n line3\n'
    const res = await tool.handler({ patch }, { experimental_sandbox: sb(dir) })
    expect(res.files).toEqual(['target.txt'])
    expect(await Bun.file(join(dir, 'target.txt')).text()).toBe('line1\nLINE2\nline3\n')
  })
  test('adds and deletes files atomically', async () => {
    await Bun.write(join(dir, 'gone.txt'), 'bye\n')
    const tool = createApplyPatchTool()
    const patch = '--- /dev/null\n+++ b/fresh.txt\n@@ -0,0 +1 @@\n+hello\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n'
    const res = await tool.handler({ patch }, { experimental_sandbox: sb(dir) })
    expect(res.files).toContain('fresh.txt')
    expect(await Bun.file(join(dir, 'fresh.txt')).text()).toBe('hello\n')
    expect(await Bun.file(join(dir, 'gone.txt')).exists()).toBe(false)
  })
  test('bad hunks fail verification without writing', async () => {
    await Bun.write(join(dir, 'safe.txt'), 'untouched\n')
    const tool = createApplyPatchTool()
    const patch = '--- a/safe.txt\n+++ b/safe.txt\n@@ -1 +1 @@\n-expected-context\n+replacement\n'
    await expect(tool.handler({ patch }, { experimental_sandbox: sb(dir) })).rejects.toThrow('verification failed')
    expect(await Bun.file(join(dir, 'safe.txt')).text()).toBe('untouched\n')
  })
  test('escape outside root is rejected', async () => {
    const tool = createApplyPatchTool()
    const patch = '--- /dev/null\n+++ b/../evil.txt\n@@ -0,0 +1 @@\n+x\n'
    await expect(tool.handler({ patch }, { experimental_sandbox: sb(dir) })).rejects.toThrow('escapes')
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
