import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { SUBAGENT_DEPTH_CAP } from '../../src/agent/agents/subagents.ts'
import { buildRulesSection, buildSkillsSection, buildSubagentsSection, generateSystemMessage } from '../../src/agent/prompts/system.ts'
import { checkpointsPath } from '../../src/agent/sessions/checkpoints.ts'
import { toPromptMessage } from '../../src/agent/sessions/session.ts'
import { forkSession, sliceMessagesUpTo } from '../../src/agent/sessions/session-fork.ts'
import { createHeadlessChatState } from '../../src/agent/sessions/session-headless-chat.ts'
import { JobTracker } from '../../src/agent/sessions/session-jobs.ts'
import { SessionManager } from '../../src/agent/sessions/session-manager.ts'
import {
  addToTotals,
  deleteSessionMeta,
  emptyTotals,
  folderKeyForSession,
  isWaiting,
  readSessionMeta,
  recoverSessionMeta,
  sessionMetaPath,
  updateSessionMeta,
  writeSessionMeta,
} from '../../src/agent/sessions/session-meta.ts'
import { folderKeyFor } from '../../src/agent/sessions/session-paths.ts'
import { deleteSessionCascade, listSessionsFor, listSessionTree } from '../../src/agent/sessions/session-queries.ts'
import { spawnSubSession } from '../../src/agent/sessions/session-spawn.ts'
import { listSessions, loadSession, writeSessionFile } from '../../src/agent/sessions/session-store.ts'
import { executorSubagentMarkdown } from '../../src/agent/subagent/executor.ts'
import { explorerSubagentMarkdown } from '../../src/agent/subagent/explorer.ts'
import { reviewerSubAgent } from '../../src/agent/subagent/reviewer.ts'
import { options } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const originalSystemDir = options.app.systemDir
function userMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as unknown as UIMessage
}
function assistantMessage(id: string, text: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] } as unknown as UIMessage
}
async function useTempSystem(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  options.app.systemDir = dir
  initLockDir(dir)
  return dir
}
describe('session meta pure helpers', () => {
  test('isWaiting detects pending ask tool', () => {
    const pending = [
      {
        role: 'assistant',
        parts: [{ type: 'tool-ask', toolCallId: 'a', state: 'output-available', input: {}, output: { status: 'pending' } }],
      },
    ]
    expect(isWaiting(pending)).toBe(true)
  })
  test('isWaiting rejects finished tool and user last message', () => {
    const finished = [
      {
        role: 'assistant',
        parts: [{ type: 'tool-ask', toolCallId: 'a', state: 'output-available', input: {}, output: { status: 'answered' } }],
      },
    ]
    expect(isWaiting(finished)).toBe(false)
    expect(isWaiting([{ role: 'user', parts: [] }])).toBe(false)
    expect(isWaiting([])).toBe(false)
  })
  test('isWaiting supports dynamic pending plan-write', () => {
    const pending = [
      {
        role: 'assistant',
        parts: [{ type: 'dynamic-tool', toolName: 'plan-write', toolCallId: 'a', state: 'output-available', input: {}, output: { status: 'pending' } }],
      },
    ]
    expect(isWaiting(pending)).toBe(true)
  })
  test('totals accumulate tokens and cost splits', () => {
    const base = emptyTotals()
    const next = addToTotals(base, {
      source: 'run',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      cost: 0.5,
      inputCost: 0.2,
      outputCost: 0.3,
    })
    expect(next.inputTokens).toBe(10)
    expect(next.outputTokens).toBe(5)
    expect(next.cost).toBe(0.5)
    expect(next.costDetails.details).toHaveLength(1)
    expect(next.costDetails.inputCost).toBe(0.2)
    const again = addToTotals(next, { source: 'run', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(again.inputTokens).toBe(11)
    expect(again.cost).toBe(0.5)
  })
})
describe('session meta persistence', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await useTempSystem('picobu-meta-')
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
  })
  test('write then read round trip', async () => {
    await writeSessionMeta('fk', 's1', { id: 's1', state: 'finished', cwd: '/tmp', createdAt: 1, updatedAt: 1 })
    const meta = await readSessionMeta('fk', 's1')
    expect(meta?.state).toBe('finished')
    expect(sessionMetaPath('fk', 's1')).toBe(join(dir, 'sessions', 'fk', 's1.meta.json'))
  })
  test('read returns null for missing or corrupt file', async () => {
    expect(await readSessionMeta('fk', 'absent')).toBeNull()
    await mkdir(join(dir, 'sessions', 'fk'), { recursive: true })
    await writeFile(join(dir, 'sessions', 'fk', 'bad.meta.json'), 'not json\n')
    expect(await readSessionMeta('fk', 'bad')).toBeNull()
  })
  test('update merges patch and keeps id', async () => {
    await writeSessionMeta('fk', 's1', { id: 's1', state: 'finished', cwd: '/tmp', createdAt: 1, updatedAt: 1 })
    const updated = await updateSessionMeta('fk', 's1', { title: 'hello' })
    expect(updated?.title).toBe('hello')
    expect(updated?.id).toBe('s1')
    expect(await updateSessionMeta('fk', 'absent', { title: 'x' })).toBeNull()
  })
  test('recover flips running to error only', async () => {
    await writeSessionMeta('fk', 'run', { id: 'run', state: 'running', cwd: '/tmp', createdAt: 1, updatedAt: 1 })
    await writeSessionMeta('fk', 'done', { id: 'done', state: 'finished', cwd: '/tmp', createdAt: 1, updatedAt: 1 })
    expect((await recoverSessionMeta('fk', 'run'))?.state).toBe('error')
    expect((await recoverSessionMeta('fk', 'done'))?.state).toBe('finished')
    expect(await recoverSessionMeta('fk', 'absent')).toBeNull()
  })
  test('delete removes meta file', async () => {
    await writeSessionMeta('fk', 's1', { id: 's1', state: 'finished', cwd: '/tmp', createdAt: 1, updatedAt: 1 })
    await deleteSessionMeta('fk', 's1')
    expect(await readSessionMeta('fk', 's1')).toBeNull()
  })
  test('folderKeyForSession follows stored cwd', async () => {
    const queryCwd = join(tmpdir(), 'query-folder-abc')
    const storedCwd = join(tmpdir(), 'stored-folder-xyz')
    const queryKey = folderKeyFor(queryCwd)
    await writeSessionMeta(queryKey, 's1', { id: 's1', state: 'finished', cwd: storedCwd, createdAt: 1, updatedAt: 1 })
    expect(await folderKeyForSession(queryCwd, 's1')).toBe(folderKeyFor(storedCwd))
    expect(await folderKeyForSession(queryCwd, 'absent')).toBe(queryKey)
  })
  test('checkpointsPath nests under session folder', () => {
    expect(checkpointsPath('fk', 's1')).toBe(join(dir, 'sessions', 'fk', 's1', 'checkpoints.jsonl'))
  })
})
describe('session store tombstone and preview', () => {
  let dir = ''
  const folderKey = 'storekey'
  beforeEach(async () => {
    dir = await useTempSystem('picobu-store-')
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
  })
  test('loadSession returns null when file is missing', async () => {
    expect(await loadSession(folderKey, 'absent')).toBeNull()
  })
  test('upsert keeps first position with newest content', async () => {
    const { sessionFilePath } = await import('../../src/agent/sessions/session-paths.ts')
    const first = JSON.stringify({ id: 'a', role: 'user', parts: [{ type: 'text', text: 'old' }] })
    const second = JSON.stringify({ id: 'b', role: 'user', parts: [{ type: 'text', text: 'bee' }] })
    const updated = JSON.stringify({ id: 'a', role: 'user', parts: [{ type: 'text', text: 'new' }] })
    await mkdir(join(dir, 'sessions', folderKey), { recursive: true })
    await writeFile(sessionFilePath(folderKey, 's1'), `${first}\n${second}\n${updated}\ncorrupt\n`)
    const loaded = await loadSession(folderKey, 's1')
    if (!loaded) throw new Error('missing session s1')
    expect(loaded.map((m) => m.id)).toEqual(['a', 'b'])
    expect((loaded[0]?.parts[0] as { text: string } | undefined)?.text).toBe('new')
  })
  test('tombstone deletes message', async () => {
    const { sessionFilePath } = await import('../../src/agent/sessions/session-paths.ts')
    await mkdir(join(dir, 'sessions', folderKey), { recursive: true })
    const kept = JSON.stringify({ id: 'keep', role: 'user', parts: [{ type: 'text', text: 'hi' }] })
    const gone = JSON.stringify({ id: 'gone', role: 'user', parts: [{ type: 'text', text: 'bye' }] })
    const tomb = JSON.stringify({ id: 'gone', tombstone: true })
    await writeFile(sessionFilePath(folderKey, 's2'), `${kept}\n${gone}\n${tomb}\n`)
    expect((await loadSession(folderKey, 's2'))?.map((m) => m.id)).toEqual(['keep'])
  })
  test('listSessions previews first user text and fallback', async () => {
    await writeSessionFile(folderKey, 'one', [userMessage('a', 'hello world')])
    await writeSessionFile(folderKey, 'two', [assistantMessage('a', 'only assistant')])
    const rows = await listSessions(folderKey)
    const byId = new Map(rows.map((r) => [r.id, r.firstPrompt]))
    expect(byId.get('one')).toBe('hello world')
    expect(byId.get('two')).toBe('(no text)')
  })
  test('listSessions skips compaction header and metadata', async () => {
    const { COMPACTION_HEADER } = await import('../../src/agent/sessions/session-compaction.ts')
    await writeSessionFile(folderKey, 'cut', [
      {
        id: 'a',
        role: 'user',
        metadata: { compaction: { summary: 's', compactedMessageIds: [], createdAt: 1 } },
        parts: [{ type: 'text', text: 'hidden' }],
      } as unknown as UIMessage,
      userMessage('b', `${COMPACTION_HEADER} summary]\n\nvisible`),
      userMessage('c', 'real first'),
    ])
    const rows = await listSessions(folderKey)
    expect(rows.find((r) => r.id === 'cut')?.firstPrompt).toBe('real first')
  })
  test('listSessions returns empty for missing dir', async () => {
    expect(await listSessions('absent-folder-xyz')).toEqual([])
  })
})
describe('session queries with tmp folderKey', () => {
  let systemDir = ''
  let cwd = ''
  let folderKey = ''
  beforeEach(async () => {
    systemDir = await mkdtemp(join(tmpdir(), 'picobu-qsys-'))
    cwd = await mkdtemp(join(tmpdir(), 'picobu-qcwd-'))
    options.app.systemDir = systemDir
    initLockDir(systemDir)
    folderKey = folderKeyFor(cwd)
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(systemDir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })
  async function seedMeta(id: string, patch: Record<string, unknown> = {}): Promise<void> {
    await writeSessionMeta(folderKey, id, { id, state: 'finished', cwd, createdAt: 1, updatedAt: 1, ...patch } as never)
  }
  test('listSessionTree nests children under roots', async () => {
    await seedMeta('root')
    await seedMeta('child', { parentSessionId: 'root' })
    await seedMeta('other-root')
    const tree = await listSessionTree(cwd)
    const root = tree.find((n) => n.id === 'root')
    if (!root) throw new Error('missing root session')
    expect(root.children.map((c) => c.id)).toEqual(['child'])
    expect(tree.find((n) => n.id === 'other-root')?.children).toEqual([])
  })
  test('listSessionsFor filters foreign cwd', async () => {
    await seedMeta('mine', { title: 'kept' })
    await writeSessionFile(folderKey, 'mine', [userMessage('a', 'hi mine')])
    await writeSessionMeta(folderKey, 'foreign', { id: 'foreign', state: 'finished', cwd: '/elsewhere', createdAt: 1, updatedAt: 1 })
    const rows = await listSessionsFor({ cwd, live: new Map() as never, jobs: new JobTracker() })
    expect(rows.map((r) => r.id)).toContain('mine')
    expect(rows.map((r) => r.id)).not.toContain('foreign')
    expect(rows.find((r) => r.id === 'mine')?.title).toBe('kept')
  })
  test('deleteSessionCascade removes subtree files', async () => {
    await seedMeta('root')
    await seedMeta('child', { parentSessionId: 'root' })
    await writeSessionFile(folderKey, 'root', [userMessage('a', 'root prompt')])
    await writeSessionFile(folderKey, 'child', [userMessage('a', 'child prompt')])
    await mkdir(join(systemDir, 'sessions', folderKey, 'child'), { recursive: true })
    await writeFile(join(systemDir, 'sessions', folderKey, 'child', 'extra.txt'), 'x')
    const removed = await deleteSessionCascade({ cwd, live: new Map() as never, jobs: new JobTracker() }, 'root')
    expect(removed).toBe(2)
    expect(await loadSession(folderKey, 'root')).toBeNull()
    expect(await readSessionMeta(folderKey, 'child')).toBeNull()
  })
  test('deleteSessionCascade throws for unknown session', async () => {
    await expect(deleteSessionCascade({ cwd, live: new Map() as never, jobs: new JobTracker() }, 'absent')).rejects.toThrow('Unknown session')
  })
  test('deleteSessionCascade refuses running session', async () => {
    await seedMeta('busy', { state: 'finished' })
    await writeSessionFile(folderKey, 'busy', [userMessage('a', 'hi')])
    const live = new Map([['busy', { state: 'running', abort: () => {} }]]) as never
    await expect(deleteSessionCascade({ cwd, live, jobs: new JobTracker() }, 'busy')).rejects.toThrow('running')
  })
})
describe('session fork slice and mocked fork', () => {
  let dir = ''
  let cwd = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-fork-sys-'))
    cwd = await mkdtemp(join(tmpdir(), 'picobu-fork-cwd-'))
    options.app.systemDir = dir
    initLockDir(dir)
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  })
  test('sliceMessagesUpTo keeps prefix inclusive', () => {
    const messages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(sliceMessagesUpTo(messages, 'b')).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(() => sliceMessagesUpTo(messages, 'absent')).toThrow('Unknown message')
  })
  test('forkSession copies messages up to id without launching agents', async () => {
    const key = folderKeyFor(cwd)
    const { sessionFilePath } = await import('../../src/agent/sessions/session-paths.ts')
    const { writeSessionMeta } = await import('../../src/agent/sessions/session-meta.ts')
    await writeSessionFile(key, 'source', [userMessage('a', 'first'), userMessage('b', 'second'), userMessage('c', 'third')])
    await writeSessionMeta(key, 'source', { id: 'source', state: 'finished', cwd, title: 'orig', createdAt: 1, updatedAt: 1 })
    let started = ''
    const result = await forkSession({ cwd, live: new Map() as never, startSession: async (id: string) => ({ id }) as never }, 'source', { upToMessageId: 'b' })
    started = result.sessionId
    expect(started.length).toBeGreaterThan(0)
    const targetKey = folderKeyFor(cwd)
    const copied = await readFile(sessionFilePath(targetKey, started), 'utf8')
    expect(copied).toContain('first')
    expect(copied).toContain('second')
    expect(copied).not.toContain('third')
  })
})
describe('spawn validation without launching', () => {
  test('rejects when spawning is disabled', async () => {
    await expect(
      spawnSubSession(
        { manager: {} as never, cwd: '/tmp', maxAgents: 0, live: new Map() as never, jobs: new JobTracker(), baseConfig: () => ({}) as never },
        { parentId: 'p', subagent: 'explorer', prompt: 'hi', depth: 0 },
      ),
    ).rejects.toThrow('Spawning is disabled')
  })
  test('rejects beyond depth cap', async () => {
    await expect(
      spawnSubSession(
        { manager: {} as never, cwd: '/tmp', maxAgents: 4, live: new Map() as never, jobs: new JobTracker(), baseConfig: () => ({}) as never },
        { parentId: 'p', subagent: 'explorer', prompt: 'hi', depth: SUBAGENT_DEPTH_CAP },
      ),
    ).rejects.toThrow('depth cap')
  })
  test('rejects nested spawn when slots are full', async () => {
    const jobs = new JobTracker()
    await jobs.acquireSlot(1)
    try {
      await expect(
        spawnSubSession(
          { manager: {} as never, cwd: '/tmp', maxAgents: 1, live: new Map() as never, jobs, baseConfig: () => ({}) as never },
          { parentId: 'p', subagent: 'explorer', prompt: 'hi', depth: 1 },
        ),
      ).rejects.toThrow('concurrency limit')
    } finally {
      jobs.releaseSlot()
    }
  })
})
describe('session manager construction', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await useTempSystem('picobu-manager-')
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
  })
  test('exposes cwd maxAgents and sandbox toggle', () => {
    const manager = new SessionManager({ cwd: dir, maxAgents: 2 })
    expect(manager.currentCwd).toBe(dir)
    expect(manager.maxAgents).toBe(2)
    expect(manager.sandboxEnabled).toBe(true)
    manager.setSandbox(false)
    expect(manager.sandboxEnabled).toBe(false)
  })
  test('starts with no jobs', () => {
    const manager = new SessionManager({ cwd: dir, maxAgents: 1 })
    expect(manager.jobs()).toEqual([])
  })
})
describe('headless chat state', () => {
  test('notifies on status error and message changes', () => {
    let calls = 0
    const state = createHeadlessChatState([], () => {
      calls += 1
    })
    state.status = 'submitted'
    state.error = new Error('boom')
    state.messages = [userMessage('a', 'hi') as never]
    expect(calls).toBe(3)
    expect(state.status).toBe('submitted')
    expect(state.error?.message).toBe('boom')
  })
  test('push pop replace and snapshot isolate', () => {
    const first = userMessage('a', 'one') as never
    const second = userMessage('b', 'two') as never
    const state = createHeadlessChatState([first])
    state.pushMessage(second)
    expect(state.messages).toHaveLength(2)
    state.popMessage()
    expect(state.messages).toHaveLength(1)
    state.replaceMessage(0, second)
    expect(state.messages[0]?.id).toBe('b')
    const snap = state.snapshot({ nested: { value: 1 } })
    snap.nested.value = 2
    expect(state.snapshot({ nested: { value: 1 } }).nested.value).toBe(1)
  })
})
describe('session prompt helper', () => {
  test('wraps string prompt into text parts', () => {
    const message = toPromptMessage('hello')
    expect(message.parts).toEqual([{ type: 'text', text: 'hello' }])
  })
  test('passes object prompt through', () => {
    const input = { parts: [{ type: 'text', text: 'kept' }] } as never
    expect(toPromptMessage(input)).toBe(input)
  })
})
describe('system prompt builders for loop cache', () => {
  test('skills and rules sections list names', () => {
    expect(buildSkillsSection([{ name: 'alpha', description: 'does alpha' }])).toContain('- alpha: does alpha')
    expect(buildRulesSection([{ name: 'beta', description: 'does beta' }])).toContain('- beta: does beta')
  })
  test('subagents section reflects concurrency limit', () => {
    expect(buildSubagentsSection([{ name: 'explorer', description: 'finds' }], 2)).toContain('Up to 2')
    expect(buildSubagentsSection([{ name: 'explorer', description: 'finds' }], 0)).toContain('disabled')
  })
  test('generated system differs with skills and rules', () => {
    const base = { appName: 'picobu', cwd: '/tmp', os: 'linux', shell: 'bash' }
    const withSkills = generateSystemMessage({ ...base, skillsInfo: buildSkillsSection([{ name: 'one', description: 'first' }]) })
    const otherSkills = generateSystemMessage({ ...base, skillsInfo: buildSkillsSection([{ name: 'two', description: 'second' }]) })
    const withRules = generateSystemMessage({ ...base, rulesInfo: buildRulesSection([{ name: 'rule', description: 'applies' }]) })
    expect(withSkills).not.toEqual(otherSkills)
    expect(withRules.some((s) => s.key === 'Rules')).toBe(true)
    expect(withSkills.some((s) => s.key === 'Skills')).toBe(true)
  })
})
describe('subagent markdown definitions', () => {
  test('executor defines name tools and input placeholder', () => {
    expect(executorSubagentMarkdown).toContain('name: Executor')
    expect(executorSubagentMarkdown).toContain('tools:')
    expect(executorSubagentMarkdown).toContain('<SPAWN_PROMPT>')
  })
  test('explorer defines name tools and input placeholder', () => {
    expect(explorerSubagentMarkdown).toContain('name: Explorer')
    expect(explorerSubagentMarkdown).toContain('tools:')
    expect(explorerSubagentMarkdown).toContain('<SPAWN_PROMPT>')
  })
  test('reviewer defines name tools and input placeholder', () => {
    expect(reviewerSubAgent).toContain('name: Reviewer')
    expect(reviewerSubAgent).toContain('tools:')
    expect(reviewerSubAgent).toContain('<SPAWN_PROMPT>')
  })
})
