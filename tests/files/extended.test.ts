import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentDirCandidates, agentDirsUnder, insideAgentDir } from '../../src/agent/tools/filesystem/agent-dirs.ts'
import { createEditTool } from '../../src/agent/tools/filesystem/edit.ts'
import { GlobToolArgsSchema, globTool } from '../../src/agent/tools/filesystem/glob.ts'
import { GrepToolArgsSchema, grepTool } from '../../src/agent/tools/filesystem/grep.ts'
import { ReadToolArgsSchema, readTool } from '../../src/agent/tools/filesystem/read.ts'
import { createShellTool, progressClipWidth, ShellToolArgsSchema, ShellToolOutputSchema, truncateLine } from '../../src/agent/tools/filesystem/shell.ts'
import { createWriteTool, WriteToolArgsSchema } from '../../src/agent/tools/filesystem/write.ts'
import { shellSpec } from '../../src/agent/tools/sandbox.ts'
import { buildToolSet } from '../../src/agent/tools/toolset.ts'
import { options } from '../../src/config/options.ts'
import { detectFiletype } from '../../src/shared/filetype.ts'
import { initLockDir, withLock } from '../../src/shared/lock.ts'
import { detectShell } from '../../src/shared/shell.ts'
import { createTreeSitterClient, getSharedTreeSitterClientSync, loadParsers } from '../../src/wrappers/treesitter-wrapper.ts'

const originalCwd = process.cwd()
const useDir = async (dir: string): Promise<void> => {
  initLockDir(join(dir, 'locks'))
  process.chdir(dir)
}
const restoreDir = async (dir: string): Promise<void> => {
  process.chdir(originalCwd)
  await rm(dir, { recursive: true, force: true })
}

describe('write/read roundtrip via tools', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-ext-'))
    await useDir(dir)
  })
  afterEach(async () => {
    await restoreDir(dir)
  })
  test('write then read returns contents and filetype', async () => {
    const write = createWriteTool()
    const out = await write.handler({ path: 'sub/note.txt', contents: 'hello\nworld' })
    expect(out.message).toBe('Wrote sub/note.txt (2 lines)')
    expect(out.content).toBe('hello\nworld')
    const got = await readTool.handler({ path: 'sub/note.txt' })
    expect(got.content).toBe('hello\nworld')
    expect(got.filetype).toBe('text')
  })
  test('read slices lines with skip/limit', async () => {
    await createWriteTool().handler({ path: 'a.txt', contents: 'one\ntwo\nthree' })
    const sliced = await readTool.handler({ path: 'a.txt', skip: 1, limit: 1 })
    expect(sliced.content).toBe('two')
    const all = await readTool.handler({ path: 'a.txt' })
    expect(all.content).toBe('one\ntwo\nthree')
  })
  test('arg schemas reject empty paths', () => {
    expect(WriteToolArgsSchema.safeParse({ path: '', contents: 'x' }).success).toBe(false)
    expect(ReadToolArgsSchema.safeParse({ path: '' }).success).toBe(false)
    expect(ReadToolArgsSchema.safeParse({ path: 'a.txt', skip: -1 }).success).toBe(false)
    expect(ReadToolArgsSchema.safeParse({ path: 'a.txt' }).success).toBe(true)
  })
})
describe('edit handler', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-edit-'))
    await useDir(dir)
  })
  afterEach(async () => {
    await restoreDir(dir)
  })
  test('replaces single occurrence and returns diff', async () => {
    await createWriteTool().handler({ path: 'f.txt', contents: 'hello foo world' })
    const edit = createEditTool()
    const res = await edit.handler({ path: 'f.txt', oldString: 'foo', newString: 'bar' })
    expect(res.message).toContain('Replaced single occurrence')
    expect(res.diff).toContain('-hello foo world')
    expect(res.diff).toContain('+hello bar world')
    const back = await readTool.handler({ path: 'f.txt' })
    expect(back.content).toBe('hello bar world')
  })
  test('ambiguous match errors', async () => {
    await createWriteTool().handler({ path: 'amb.txt', contents: 'foo foo' })
    await expect(createEditTool().handler({ path: 'amb.txt', oldString: 'foo', newString: 'bar' })).rejects.toThrow('multiple matches')
  })
  test('missing file errors', async () => {
    await expect(createEditTool().handler({ path: 'missing.txt', oldString: 'a', newString: 'b' })).rejects.toThrow('File not found')
  })
})
describe('glob and grep', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-gg-'))
    await useDir(dir)
    await Bun.write(join(dir, 'a.txt'), 'hello world')
    await Bun.write(join(dir, 'b.md'), 'other')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await Bun.write(join(dir, 'sub', 'c.txt'), 'hello again')
  })
  afterEach(async () => {
    await restoreDir(dir)
  })
  test('glob schema requires pattern and path', () => {
    expect(GlobToolArgsSchema.safeParse({ pattern: '**/*.txt', path: '.' }).success).toBe(true)
    expect(GlobToolArgsSchema.safeParse({ pattern: '**/*.txt' }).success).toBe(false)
    expect(GlobToolArgsSchema.safeParse({ path: '.' }).success).toBe(false)
    expect(GlobToolArgsSchema.safeParse({ pattern: '**/*.txt', path: '' }).success).toBe(false)
  })
  test('glob finds txt files in tmp dir', async () => {
    const signal = new AbortController().signal
    const out = await globTool.handler({ pattern: '**/*.txt', path: '.' }, { abortSignal: signal })
    const lines = out.split('\n').filter(Boolean)
    expect(lines).toContain('a.txt')
    expect(lines).toContain(join('sub', 'c.txt'))
    expect(lines).not.toContain('b.md')
  })
  test('grep schema requires non-empty pattern and path', () => {
    expect(GrepToolArgsSchema.safeParse({ pattern: 'hello', path: '.' }).success).toBe(true)
    expect(GrepToolArgsSchema.safeParse({ pattern: 'hello' }).success).toBe(false)
    expect(GrepToolArgsSchema.safeParse({ pattern: '', path: '.' }).success).toBe(false)
    expect(GrepToolArgsSchema.safeParse({}).success).toBe(false)
  })
  test('grep finds matches in tmp dir', async () => {
    const signal = new AbortController().signal
    const res = await grepTool.handler({ pattern: 'hello', path: '.' }, { abortSignal: signal })
    expect(res.content).toContain('hello world')
    expect(res.content).toContain('hello again')
    expect(res.filetype).toBe('text')
  })
  test('grep reports no matches', async () => {
    const res = await grepTool.handler({ pattern: 'zzz-no-such-token-zzz', path: '.' })
    expect(res.content).toContain('No matches')
  })
  test('grep caps output at limit with footer', async () => {
    for (let i = 0; i < 10; i++) await Bun.write(join(dir, `m${i}.txt`), 'hello match')
    const res = await grepTool.handler({ pattern: 'hello', path: '.', limit: 2 })
    expect(res.content).toContain('Results truncated to 2')
  })
  test('glob caps output at limit with footer', async () => {
    for (let i = 0; i < 10; i++) await Bun.write(join(dir, `g${i}.txt`), 'x')
    const out = await globTool.handler({ pattern: '**/*.txt', path: '.', limit: 3 })
    const lines = out.split('\n').filter(Boolean)
    expect(lines.length).toBe(4)
    expect(out).toContain('Results truncated to 3')
  })
  test('grep and glob respect gitignore', async () => {
    await Bun.write(join(dir, '.gitignore'), 'ignored.txt\nignored-dir/\n')
    await Bun.write(join(dir, 'ignored.txt'), 'hello ignored')
    await mkdir(join(dir, 'ignored-dir'), { recursive: true })
    await Bun.write(join(dir, 'ignored-dir', 'inner.txt'), 'hello inner')
    await Bun.$`git init -q`.cwd(dir).quiet()
    const res = await grepTool.handler({ pattern: 'hello', path: '.' })
    expect(res.content).not.toContain('ignored.txt')
    expect(res.content).not.toContain('inner.txt')
    const out = await globTool.handler({ pattern: '**/*.txt', path: '.' })
    expect(out).not.toContain('ignored.txt')
    expect(out).not.toContain('inner.txt')
  })
})
describe('shell tool', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-shell-'))
    await useDir(dir)
  })
  afterEach(async () => {
    await restoreDir(dir)
  })
  test('arg schema validates command and timeout', () => {
    expect(ShellToolArgsSchema.safeParse({ command: 'echo hi' }).success).toBe(true)
    expect(ShellToolArgsSchema.safeParse({ command: 'echo hi', timeout: 60 }).success).toBe(true)
    expect(ShellToolArgsSchema.safeParse({}).success).toBe(false)
    expect(ShellToolArgsSchema.safeParse({ command: 'echo hi', timeout: 0 }).success).toBe(false)
    expect(ShellToolArgsSchema.safeParse({ command: 'echo hi', timeout: 601 }).success).toBe(false)
  })
  test('progress clip width follows terminal columns', () => {
    expect(progressClipWidth(120)).toBe(114)
    expect(progressClipWidth(200)).toBe(194)
    expect(progressClipWidth(undefined)).toBe(120)
    expect(progressClipWidth(0)).toBe(120)
    expect(progressClipWidth(10)).toBe(20)
  })
  test('truncateLine clips to max with an ellipsis', () => {
    expect(truncateLine('x'.repeat(200), 114)).toHaveLength(114)
    expect(truncateLine('x'.repeat(200), 114).endsWith('…')).toBe(true)
    expect(truncateLine('short', 114)).toBe('short')
  })
  test('output schema accepts string and progress', () => {
    expect(ShellToolOutputSchema.safeParse('hi').success).toBe(true)
    expect(ShellToolOutputSchema.safeParse({ progress: 'working' }).success).toBe(true)
    expect(ShellToolOutputSchema.safeParse({}).success).toBe(false)
  })
  test('echo returns trimmed output', async () => {
    const shell = createShellTool()
    let final = ''
    for await (const chunk of shell.handler({ command: 'echo hi' })) {
      if (typeof chunk === 'string') final = chunk
    }
    expect(final).toBe('hi')
  })
  test('true reports no output', async () => {
    const shell = createShellTool()
    let final = ''
    for await (const chunk of shell.handler({ command: 'true' })) {
      if (typeof chunk === 'string') final = chunk
    }
    expect(final).toBe('(no output)')
  })
  test('failing command throws with exit code', async () => {
    const shell = createShellTool()
    const collect = async () => {
      for await (const chunk of shell.handler({ command: 'exit 3' })) {
        void chunk
      }
    }
    await expect(collect()).rejects.toThrow('exited 3')
  })
  test('large output is tailed near 50KB with a spill file note', async () => {
    const shell = createShellTool()
    let final = ''
    for await (const chunk of shell.handler({ command: 'awk \'BEGIN{for(i=0;i<150000;i++)printf "x";}\'', timeout: 30 })) {
      if (typeof chunk === 'string') final = chunk
    }
    expect(final.length).toBeLessThanOrEqual(60000)
    expect(final.length).toBeGreaterThan(40000)
    expect(final).toContain('Full output saved to:')
  })
})
describe('agent dirs', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-agdir-'))
    initLockDir(join(dir, 'locks'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  test('candidates shape lists base then globals then system', () => {
    const base = join(dir, 'proj')
    const got = agentDirCandidates(base)
    expect(got).toHaveLength(8)
    expect(got[0]).toBe(join(base, '.agents'))
    expect(got).toContain(join(options.app.cwd, '.agents'))
    expect(got).toContain(join(options.app.homeDir, '.agents'))
    expect(got).toContain(join(options.app.systemDir, 'skills'))
    expect(got).toContain(join(options.app.systemDir, 'rules'))
  })
  test('agentDirsUnder returns existing .agents child', async () => {
    await mkdir(join(dir, '.agents'), { recursive: true })
    const found = await agentDirsUnder(dir)
    expect(found).toContain(join(dir, '.agents'))
  })
  test('insideAgentDir edge cases', () => {
    expect(insideAgentDir(join('proj', '.agents', 'skills', 'x.md'))).toBe(true)
    expect(insideAgentDir(join(options.app.systemDir, 'skills', 'x.md'))).toBe(true)
    expect(insideAgentDir(join(options.app.systemDir, 'rules', 'y.md'))).toBe(true)
    expect(insideAgentDir(join(dir, 'foo', 'bar.txt'))).toBe(false)
    expect(insideAgentDir(join(dir, '.agents-backup', 'file.txt'))).toBe(false)
    expect(insideAgentDir(join('proj', '.agents', '..foo', 'x.md'))).toBe(true)
  })
})
describe('shell spec mapping', () => {
  test('shellSpec maps known shells', () => {
    expect(shellSpec('Windows:PowerShell')).toEqual({ cmd: ['powershell', '-Command'] })
    expect(shellSpec('Windows:Bash')).toEqual({ cmd: ['bash', '-c'] })
    expect(shellSpec('Windows:cmd.exe')).toEqual({ cmd: ['cmd', '/c'] })
    expect(shellSpec('Unix:Zsh')).toEqual({ cmd: ['zsh', '-c'] })
    expect(shellSpec('Unix:Bash')).toEqual({ cmd: ['bash', '-c'] })
    expect(shellSpec('Unix:Fish')).toEqual({ cmd: ['fish', '-c'] })
    expect(shellSpec('Unix:Sh')).toEqual({ cmd: ['sh', '-c'] })
  })
  test('shellSpec falls back to SHELL or sh', () => {
    const res = shellSpec('Bogus:Label')
    expect(res.cmd).toHaveLength(2)
    expect(res.cmd[1]).toBe('-c')
  })
})
describe('lock behavior', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-lock-'))
    initLockDir(join(dir, 'locks'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  test('rejects control-char paths', async () => {
    await expect(withLock(join(dir, 'a\tb'), async () => {})).rejects.toThrow('control')
    await expect(withLock(join(dir, 'a\nb'), async () => {})).rejects.toThrow('control')
    await expect(withLock(join(dir, 'a\rb'), async () => {})).rejects.toThrow('control')
  })
  test('reentrant same-path does not deadlock', async () => {
    const p = join(dir, 'f.txt')
    const val = await withLock(p, async () => withLock(p, async () => 42))
    expect(val).toBe(42)
  })
  test('serializes concurrent writes in order', async () => {
    const p = join(dir, 'ordered.txt')
    const order: string[] = []
    await Promise.all([
      withLock(p, async () => {
        order.push('a-start')
        await Bun.sleep(50)
        order.push('a-end')
      }),
      withLock(p, async () => {
        order.push('b-start')
        await Bun.sleep(10)
        order.push('b-end')
      }),
    ])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })
})
describe('filetype and shell detect', () => {
  test('detectFiletype maps common extensions', () => {
    expect(detectFiletype('a.ts')).toBe('typescript')
    expect(detectFiletype('a.tsx')).toBe('tsx')
    expect(detectFiletype('a.js')).toBe('javascript')
    expect(detectFiletype('a.jsx')).toBe('jsx')
    expect(detectFiletype('a.json')).toBe('json')
    expect(detectFiletype('a.md')).toBe('markdown')
    expect(detectFiletype('a.py')).toBe('python')
    expect(detectFiletype('a.go')).toBe('go')
    expect(detectFiletype('a.rs')).toBe('rust')
    expect(detectFiletype('a.sh')).toBe('bash')
    expect(detectFiletype('a.yaml')).toBe('yaml')
    expect(detectFiletype('a.toml')).toBe('toml')
    expect(detectFiletype('a.sql')).toBe('sql')
    expect(detectFiletype('a.html')).toBe('html')
    expect(detectFiletype('a.css')).toBe('css')
    expect(detectFiletype('a.php')).toBe('php')
  })
  test('detectFiletype falls back and handles dotfiles and case', () => {
    expect(detectFiletype('a.unknown')).toBe('text')
    expect(detectFiletype('noext')).toBe('text')
    expect(detectFiletype('.env')).toBe('text')
    expect(detectFiletype('dir/.gitignore')).toBe('text')
    expect(detectFiletype('A.TS')).toBe('typescript')
  })
  test('detectShell maps SHELL env on unix', () => {
    const prev = Bun.env.SHELL
    Bun.env.SHELL = '/bin/zsh'
    expect(detectShell()).toBe('Unix:Zsh')
    Bun.env.SHELL = '/bin/bash'
    expect(detectShell()).toBe('Unix:Bash')
    Bun.env.SHELL = '/usr/bin/fish'
    expect(detectShell()).toBe('Unix:Fish')
    Bun.env.SHELL = '/bin/sh'
    expect(detectShell()).toBe('Unix:Sh')
    Bun.env.SHELL = prev
  })
})
describe('toolset registry', () => {
  test('base set lists filesystem and discovery tools', () => {
    const names = buildToolSet({})
      .getTools()
      .map((t) => t.name)
    for (const want of ['read', 'write', 'edit', 'glob', 'grep', 'shell', 'skill', 'rule']) {
      expect(names).toContain(want)
    }
    expect(names).not.toContain('ask')
    expect(names).not.toContain('plan-write')
    expect(names).not.toContain('todo')
    expect(names).not.toContain('spawn')
  })
  test('full context adds todo ask plan and spawn', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'picobu-tools-'))
    try {
      const fake = { spawnSubSession: async () => ({ summary: 's' }) }
      const names = buildToolSet({ todoFilePath: join(dir, 'todos.json'), sessionId: 's1', spawn: { manager: fake as never, parentId: 'p', depth: 0 } })
        .getTools()
        .map((t) => t.name)
      for (const want of ['todo', 'ask', 'grill-exit', 'plan-exit', 'plan-write', 'spawn']) {
        expect(names).toContain(want)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  test('interactive false omits ask and plan tools but keeps spawn', () => {
    const fake = { spawnSubSession: async () => ({ summary: 's' }) }
    const names = buildToolSet({ sessionId: 's1', interactive: false, spawn: { manager: fake as never, parentId: 'p', depth: 0 } })
      .getTools()
      .map((t) => t.name)
    expect(names).not.toContain('ask')
    expect(names).not.toContain('plan-write')
    expect(names).not.toContain('plan-exit')
    expect(names).not.toContain('grill-exit')
    expect(names).toContain('spawn')
  })
  test('getToolSet returns keyed entries', () => {
    const set = buildToolSet({}).getToolSet(['read', 'write'])
    expect(Object.keys(set).sort()).toEqual(['read', 'write'])
  })
})
describe('treesitter wrapper static', () => {
  test('exports pure constructors without wasm init', () => {
    expect(typeof loadParsers).toBe('function')
    expect(typeof createTreeSitterClient).toBe('function')
    expect(typeof getSharedTreeSitterClientSync).toBe('function')
  })
})
