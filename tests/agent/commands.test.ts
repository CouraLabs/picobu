import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommandPrompt, loadCommandCatalogSync } from '../../src/agent/commands/discovery.ts'
import { matchSystemCommand, parseCommandLine, SYSTEM_COMMANDS, toKebab, tokenizeCommandLine } from '../../src/agent/commands/parse-command-line.ts'
import type { Command } from '../../src/agent/commands/types.ts'
import { BUILTIN_WORKFLOWS } from '../../src/agent/workflows/builtin.ts'

const workflow = (name: string): Command => ({
  kind: 'workflow',
  name,
  aliases: [],
  title: name,
  description: `${name} description`,
  path: `/tmp/${name}.md`,
})

const skill = (name: string): Command => ({
  kind: 'skill',
  name,
  aliases: [],
  title: name,
  description: `${name} skill`,
  path: `/tmp/${name}/SKILL.md`,
})

describe('toKebab', () => {
  test('lowercases and dashes spaces', () => {
    expect(toKebab('My Workflow')).toBe('my-workflow')
    expect(toKebab('Some_Name')).toBe('some-name')
    expect(toKebab('  Compact  ')).toBe('compact')
  })
})

describe('matchSystemCommand', () => {
  test('matches names and aliases', () => {
    expect(matchSystemCommand('q')?.name).toBe('q')
    expect(matchSystemCommand('exit')?.name).toBe('q')
    expect(matchSystemCommand('leave')?.name).toBe('q')
    expect(matchSystemCommand('compact')?.name).toBe('compact')
    expect(matchSystemCommand('roles')?.name).toBe('roles')
    expect(matchSystemCommand('cd')?.name).toBe('cd')
    expect(matchSystemCommand('reload')?.name).toBe('reload')
  })
  test('rejects unknown names', () => {
    expect(matchSystemCommand('nope')).toBeUndefined()
  })
  test('every system command has usage and description', () => {
    for (const cmd of SYSTEM_COMMANDS) {
      expect(cmd.usage.startsWith('/')).toBe(true)
      expect(cmd.description.length).toBeGreaterThan(0)
    }
  })
})

describe('parseCommandLine', () => {
  test('returns null for non-command text', () => {
    expect(parseCommandLine('hello', [])).toBeNull()
  })
  test('parses a single skill with prompt', () => {
    const parsed = parseCommandLine('/skill:review check this diff', [skill('review')])
    expect(parsed?.kind).toBe('skills')
    if (parsed?.kind !== 'skills') throw new Error('unreachable')
    expect(parsed.skills).toEqual(['review'])
    expect(parsed.prompt).toBe('check this diff')
  })
  test('chains multiple skills with prompt', () => {
    const parsed = parseCommandLine('/skill:review /skill:tests check this', [skill('review'), skill('tests')])
    expect(parsed?.kind).toBe('skills')
    if (parsed?.kind !== 'skills') throw new Error('unreachable')
    expect(parsed.skills).toEqual(['review', 'tests'])
    expect(parsed.prompt).toBe('check this')
  })
  test('allows load-only skill chains', () => {
    const parsed = parseCommandLine('/skill:review', [skill('review')])
    expect(parsed?.kind).toBe('skills')
    if (parsed?.kind !== 'skills') throw new Error('unreachable')
    expect(parsed.prompt).toBe('')
  })
  test('parses system commands with args', () => {
    const parsed = parseCommandLine('/cd ~/other', [])
    expect(parsed?.kind).toBe('system')
    if (parsed?.kind !== 'system') throw new Error('unreachable')
    expect(parsed.command.name).toBe('cd')
    expect(parsed.args).toBe('~/other')
  })
  test('resolves aliases to system commands', () => {
    const parsed = parseCommandLine('/exit', [])
    expect(parsed?.kind).toBe('system')
    if (parsed?.kind !== 'system') throw new Error('unreachable')
    expect(parsed.command.name).toBe('q')
  })
  test('resolves kebab workflow names', () => {
    const parsed = parseCommandLine('/my-workflow some arg', [workflow('My Workflow')])
    expect(parsed?.kind).toBe('workflow')
    if (parsed?.kind !== 'workflow') throw new Error('unreachable')
    expect(parsed.command.name).toBe('My Workflow')
    expect(parsed.args).toBe('some arg')
  })
  test('reports unknown commands', () => {
    const parsed = parseCommandLine('/nope', [])
    expect(parsed?.kind).toBe('unknown')
  })
})

describe('tokenizeCommandLine', () => {
  test('marks skill and command tokens', () => {
    const tokens = tokenizeCommandLine('/skill:review /compact check it')
    const kinds = tokens.filter((t) => t.text.trim().length > 0).map((t) => [t.text, t.kind])
    expect(kinds).toEqual([
      ['/skill:review', 'skill'],
      ['/compact', 'command'],
      ['check', 'text'],
      ['it', 'text'],
    ])
  })
  test('treats plain text as text', () => {
    expect(tokenizeCommandLine('hello')?.[0]?.kind).toBe('text')
  })
})

describe('builtin workflows', () => {
  test('ships an in-memory init workflow', () => {
    const init = BUILTIN_WORKFLOWS.find((c) => c.name === 'init')
    expect(init?.kind).toBe('workflow')
    expect(init?.description.length).toBeGreaterThan(0)
    expect(init?.content).toContain('{USER_PROMPT}')
  })
  test('a same-name disk workflow replaces the builtin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'picobu-wf-'))
    await mkdir(join(dir, '.agents', 'workflows'), { recursive: true })
    await writeFile(join(dir, '.agents', 'workflows', 'init.md'), '---\nname: init\ndescription: custom\n---\nCustom body {USER_PROMPT}\n')
    const inits = loadCommandCatalogSync(dir).filter((c) => c.kind === 'workflow' && c.name.toLowerCase() === 'init')
    expect(inits.length).toBe(1)
    expect(inits[0]?.content).toBeUndefined()
    expect(inits[0]?.description).toBe('custom')
  })
  test('buildCommandPrompt injects args into the builtin', async () => {
    const init = BUILTIN_WORKFLOWS.find((c) => c.name === 'init')
    if (!init) throw new Error('missing builtin init')
    const prompt = await buildCommandPrompt(init, 'focus on tests')
    expect(prompt).toContain('focus on tests')
    expect(prompt).not.toContain('{USER_PROMPT}')
  })
})
