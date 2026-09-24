import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadMcpConfigDetailed, loadProjectMcpServers, projectMcpFileCandidates, scanProjectMcpServers } from '../../src/integrations/mcp/discover.ts'

let dir: string

const writeJson = async (relativePath: string, value: unknown): Promise<void> => {
  const target = join(dir, relativePath)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, JSON.stringify(value), 'utf8')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'picobu-mcp-discover-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('projectMcpFileCandidates', () => {
  test('groups by file kind then folder, root last (higher precedence)', () => {
    expect(projectMcpFileCandidates(['alpha', 'beta'])).toEqual([join('alpha', 'mcp.json'), join('beta', 'mcp.json'), join('alpha', '.mcp.json'), join('beta', '.mcp.json'), 'mcp.json', '.mcp.json'])
  })
  test('with no subfolders only the root files remain', () => {
    expect(projectMcpFileCandidates([])).toEqual(['mcp.json', '.mcp.json'])
  })
})

describe('scanProjectMcpServers', () => {
  test('reads both file names at the root and in every first-level folder', async () => {
    await writeJson('.mcp.json', { mcpServers: { root_dot: { url: 'https://x/root-dot' } } })
    await writeJson('mcp.json', { mcpServers: { root_plain: { url: 'https://x/root-plain' } } })
    await writeJson('pkg-a/.mcp.json', { mcpServers: { a_dot: { url: 'https://x/a-dot' } } })
    await writeJson('pkg-a/mcp.json', { servers: { a_plain: { url: 'https://x/a-plain' } } })
    await writeJson('pkg-b/.mcp.json', { mcpServers: { b_dot: { url: 'https://x/b-dot' } } })
    const rows = await loadProjectMcpServers(dir)
    expect(rows.map((server) => server.id).sort()).toEqual(['a_dot', 'a_plain', 'b_dot', 'root_dot', 'root_plain'])
  })
  test('root config overrides first-level folders and .mcp.json overrides mcp.json', async () => {
    await writeJson('pkg/.mcp.json', { mcpServers: { shared: { url: 'https://x/pkg-dot' } } })
    await writeJson('mcp.json', { mcpServers: { shared: { url: 'https://x/root-plain' } } })
    await writeJson('.mcp.json', { mcpServers: { shared: { url: 'https://x/root-dot' } } })
    expect(await loadProjectMcpServers(dir)).toEqual([{ id: 'shared', type: 'http', url: 'https://x/root-dot' }])
  })
  test('a folder .mcp.json outranks any folder mcp.json regardless of folder name', async () => {
    await writeJson('aaa/.mcp.json', { mcpServers: { shared: { url: 'https://x/aaa-dot' } } })
    await writeJson('zzz/mcp.json', { mcpServers: { shared: { url: 'https://x/zzz-plain' } } })
    expect(await loadProjectMcpServers(dir)).toEqual([{ id: 'shared', type: 'http', url: 'https://x/aaa-dot' }])
  })
  test('follows a first-level folder that is a symlink to a directory', async () => {
    const target = await mkdtemp(join(tmpdir(), 'picobu-mcp-link-'))
    await writeFile(join(target, '.mcp.json'), JSON.stringify({ mcpServers: { viasym: { url: 'https://x/viasym' } } }), 'utf8')
    await symlink(target, join(dir, 'linked'), 'dir')
    const rows = await loadProjectMcpServers(dir)
    expect(rows.map((server) => server.id)).toContain('viasym')
    await rm(target, { recursive: true, force: true })
  })
  test('skips a broken symlink without throwing', async () => {
    await symlink(join(dir, 'does-not-exist'), join(dir, 'dangling'), 'dir')
    await writeJson('.mcp.json', { mcpServers: { good: { url: 'https://x/good' } } })
    const rows = await loadProjectMcpServers(dir)
    expect(rows.map((server) => server.id)).toEqual(['good'])
  })
  test('a malformed file is warned about without blocking the others', async () => {
    await writeJson('.mcp.json', { mcpServers: { good: { url: 'https://x/good' } } })
    await writeFile(join(dir, 'mcp.json'), '{ not json', 'utf8')
    const result = await scanProjectMcpServers(dir)
    expect(result.servers.map((server) => server.id)).toEqual(['good'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('mcp.json is not valid JSON')
  })
})

describe('loadMcpConfigDetailed', () => {
  test('merges project files over global servers and reports no warning when clean', async () => {
    await writeJson('pkg/.mcp.json', { mcpServers: { scoped: { url: 'https://x/scoped' } } })
    const result = await loadMcpConfigDetailed(dir)
    expect(result.servers.map((server) => server.id)).toContain('scoped')
    expect(result.warning).toBeUndefined()
  })
  test('joins warnings from every bad project file', async () => {
    await writeFile(join(dir, '.mcp.json'), 'nope', 'utf8')
    await writeFile(join(dir, 'mcp.json'), 'nope', 'utf8')
    const result = await loadMcpConfigDetailed(dir)
    expect(result.warning?.split('\n')).toHaveLength(2)
  })
})
