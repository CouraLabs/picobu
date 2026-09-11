import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { CheckpointStore } from '../../src/agent/sessions/checkpoints.ts'
import {
  addPrompt,
  clearDraft,
  clearPromptHistory,
  flushPromptHistory,
  loadDraft,
  loadPromptHistory,
  PROMPT_HISTORY_LIMIT,
  projectKeyFor,
  resetPromptHistoryCache,
  saveDraft,
} from '../../src/agent/sessions/prompt-history.ts'
import {
  buildPlanHandoffCut,
  COMPACTION_HEADER,
  compactedMessageText,
  isCompactionCut,
  messagesForLlm,
  PLAN_HANDOFF_HEADER,
  serializeForCompaction,
} from '../../src/agent/sessions/session-compaction.ts'
import { JobTracker } from '../../src/agent/sessions/session-jobs.ts'
import { dropUnansweredPrompt, hasVisibleResponse, lastAssistantText, sanitizeMessages, settleAbortedToolParts, stripUnreplayableReasoning } from '../../src/agent/sessions/session-messages.ts'
import { folderKeyFor, generateSessionId, persistentRoot, persistentTurnFilePath, sessionDir, sessionFilePath, sessionsRoot, sessionTodoFilePath } from '../../src/agent/sessions/session-paths.ts'
import { options } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const originalSystemDir = options.app.systemDir
function textMessage(id: string, role: 'user' | 'assistant' | 'system', text: string): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as unknown as UIMessage
}
function toolMessage(id: string, part: unknown): UIMessage {
  return { id, role: 'assistant', parts: [part] } as unknown as UIMessage
}
describe('folderKeyFor sanitization', () => {
  test('lowercases basename', () => {
    expect(folderKeyFor('/tmp/MyProject')).toBe('myproject')
  })
  test('replaces spaces and symbols with dash', () => {
    expect(folderKeyFor('/tmp/My Project!')).toBe('my-project')
  })
  test('trims leading and trailing dashes', () => {
    expect(folderKeyFor('/tmp/--hello--')).toBe('hello')
  })
  test('falls back to default for empty key', () => {
    expect(folderKeyFor('/')).toBe('default')
  })
  test('preserves dots underscores and dashes', () => {
    expect(folderKeyFor('/tmp/a_b-c.d')).toBe('a_b-c.d')
  })
  test('uses basename only', () => {
    expect(folderKeyFor('/a/B_C-1.2')).toBe('b_c-1.2')
  })
})
describe('session paths join systemDir', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-paths-'))
    options.app.systemDir = dir
    initLockDir(dir)
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
  })
  test('sessionsRoot nests sessions under systemDir', () => {
    expect(sessionsRoot()).toBe(join(dir, 'sessions'))
  })
  test('sessionDir nests folderKey under root', () => {
    expect(sessionDir('myproj')).toBe(join(dir, 'sessions', 'myproj'))
  })
  test('sessionFilePath appends jsonl extension', () => {
    expect(sessionFilePath('myproj', 'abc')).toBe(join(dir, 'sessions', 'myproj', 'abc.jsonl'))
  })
  test('sessionTodoFilePath nests todo file under session folder', () => {
    expect(sessionTodoFilePath('myproj', 'abc')).toBe(join(dir, 'sessions', 'myproj', 'abc', 'session-todo.json'))
  })
  test('persistent paths nest under persistent folder', () => {
    expect(persistentRoot()).toBe(join(dir, 'sessions', 'persitent'))
    expect(persistentTurnFilePath(123, 2)).toBe(join(dir, 'sessions', 'persitent', '123-2.jsonl'))
  })
  test('generateSessionId returns sixteen hex chars', () => {
    const first = generateSessionId()
    const second = generateSessionId()
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(second).toMatch(/^[0-9a-f]{16}$/)
  })
})
describe('sanitizeMessages filtering', () => {
  test('preserves text order', () => {
    const input = [textMessage('a', 'user', 'first'), textMessage('b', 'user', 'second'), textMessage('c', 'user', 'third')]
    expect(sanitizeMessages(input).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
  test('keeps text and drops preliminary tool part in same message', () => {
    const mixed = {
      id: 'm',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'tool-read', toolCallId: 't', state: 'input-available', input: {}, preliminary: true },
      ],
    } as unknown as UIMessage
    const out = sanitizeMessages([mixed])
    expect(out).toHaveLength(1)
    expect(out[0]?.parts).toHaveLength(1)
  })
  test('drops message with only streaming tool part', () => {
    const streaming = toolMessage('s', { type: 'tool-read', toolCallId: 't', state: 'input-streaming', input: {} })
    expect(sanitizeMessages([streaming])).toEqual([])
  })
  test('keeps completed tool states', () => {
    const states = ['output-available', 'output-error', 'output-denied', 'approval-responded']
    for (const state of states) {
      const message = toolMessage(state, { type: 'tool-read', toolCallId: state, state, input: {}, output: {} })
      expect(sanitizeMessages([message])).toHaveLength(1)
    }
  })
  test('drops dynamic preliminary tool part', () => {
    const dynamic = toolMessage('d', { type: 'dynamic-tool', toolName: 'read', toolCallId: 't', state: 'output-available', preliminary: true })
    expect(sanitizeMessages([dynamic])).toEqual([])
  })
  test('keeps dynamic completed tool part', () => {
    const dynamic = toolMessage('d', { type: 'dynamic-tool', toolName: 'read', toolCallId: 't', state: 'output-available', input: {}, output: {} })
    expect(sanitizeMessages([dynamic])).toHaveLength(1)
  })
})
describe('session message helpers', () => {
  test('hasVisibleResponse detects text and completed tools', () => {
    expect(hasVisibleResponse(textMessage('a', 'assistant', '  hi  '))).toBe(true)
    expect(hasVisibleResponse(textMessage('b', 'assistant', '   '))).toBe(false)
    expect(hasVisibleResponse(toolMessage('c', { type: 'tool-read', toolCallId: 't', state: 'output-available' }))).toBe(true)
    expect(hasVisibleResponse(toolMessage('d', { type: 'tool-read', toolCallId: 't', state: 'input-streaming' }))).toBe(false)
  })
  test('lastAssistantText returns newest non empty assistant text', () => {
    const messages = [textMessage('a', 'assistant', 'first'), textMessage('b', 'user', 'q'), textMessage('c', 'assistant', 'second')]
    expect(lastAssistantText(messages as UIMessage[])).toBe('second')
    expect(lastAssistantText([textMessage('a', 'user', 'only')] as UIMessage[])).toBeUndefined()
  })
  test('dropUnansweredPrompt removes trailing empty assistant and user pair', () => {
    const emptyAssistant = toolMessage('b', { type: 'tool-read', toolCallId: 't', state: 'input-streaming', input: {} })
    const pair = [textMessage('a', 'user', 'q'), emptyAssistant]
    expect(dropUnansweredPrompt(pair as UIMessage[])).toEqual([])
    expect(dropUnansweredPrompt([textMessage('a', 'user', 'q')] as UIMessage[])).toEqual([])
  })
  test('stripUnreplayableReasoning keeps signed reasoning only', () => {
    const message = {
      id: 'r',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'unsigned' },
        { type: 'reasoning', text: 'signed', providerMetadata: { anthropic: { signature: 'sig' } } },
        { type: 'text', text: 'done' },
      ],
    } as unknown as UIMessage
    const out = stripUnreplayableReasoning([message])
    expect(out[0]?.parts?.map((p) => (p as { text?: string }).text)).toEqual(['signed', 'done'])
  })
})

describe('settleAbortedToolParts', () => {
  test('marks running tool parts as output-error', () => {
    const message = toolMessage('a', { type: 'tool-shell', toolCallId: 't1', state: 'input-available', input: { command: 'bun test' } })
    const out = settleAbortedToolParts([message] as UIMessage[])
    const part = out[0]?.parts?.[0] as { state?: string; errorText?: string; output?: unknown }
    expect(part.state).toBe('output-error')
    expect(part.errorText).toBe('Aborted')
  })
  test('settles input-streaming and dynamic-tool parts', () => {
    const streaming = toolMessage('a', { type: 'tool-shell', toolCallId: 't1', state: 'input-streaming', input: {} })
    const dynamic = toolMessage('b', { type: 'dynamic-tool', toolName: 'ask', toolCallId: 't2', state: 'input-available', input: {} })
    const out = settleAbortedToolParts([streaming, dynamic] as UIMessage[])
    const first = out[0]?.parts?.[0] as { state?: string } | undefined
    const second = out[1]?.parts?.[0] as { state?: string } | undefined
    expect(first?.state).toBe('output-error')
    expect(second?.state).toBe('output-error')
  })
  test('keeps settled tool parts untouched and returns identity when nothing changed', () => {
    const done = toolMessage('a', { type: 'tool-read', toolCallId: 't1', state: 'output-available', output: 'ok' })
    const text = textMessage('b', 'user', 'hi')
    const input = [done, text] as UIMessage[]
    expect(settleAbortedToolParts(input)).toBe(input)
  })
})
describe('prompt history with tmp file', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-history-'))
    options.app.systemDir = dir
    initLockDir(dir)
    resetPromptHistoryCache()
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    resetPromptHistoryCache()
    await rm(dir, { recursive: true, force: true })
  })
  test('addPrompt trims and ignores blank input', () => {
    expect(addPrompt('  hello  ')).toEqual(['hello'])
    expect(addPrompt('   ')).toEqual(['hello'])
  })
  test('addPrompt moves duplicate to end', () => {
    addPrompt('one')
    addPrompt('two')
    expect(addPrompt('one')).toEqual(['two', 'one'])
  })
  test('caps stored prompts at limit keeping newest', () => {
    for (let index = 0; index < PROMPT_HISTORY_LIMIT + 4; index++) {
      addPrompt(`prompt-${index}`)
    }
    const current = loadPromptHistory()
    expect(current).toHaveLength(PROMPT_HISTORY_LIMIT)
    expect(current[0]).toBe('prompt-4')
    expect(current[current.length - 1]).toBe(`prompt-${PROMPT_HISTORY_LIMIT + 3}`)
  })
  test('loadPromptHistory returns isolated copy', () => {
    addPrompt('solo')
    const first = loadPromptHistory()
    first.push('mutated')
    expect(loadPromptHistory()).toEqual(['solo'])
  })
  test('persists prompts across cache reset', async () => {
    addPrompt('persisted')
    await flushPromptHistory()
    resetPromptHistoryCache()
    expect(loadPromptHistory()).toEqual(['persisted'])
  })
  test('history is scoped per project key', () => {
    addPrompt('alpha-prompt', 'alpha-11111111')
    addPrompt('beta-prompt', 'beta-22222222')
    expect(loadPromptHistory('alpha-11111111')).toEqual(['alpha-prompt'])
    expect(loadPromptHistory('beta-22222222')).toEqual(['beta-prompt'])
  })
  test('drafts round-trip per project key', () => {
    saveDraft('half-typed thought', 'alpha-11111111')
    expect(loadDraft('alpha-11111111')).toBe('half-typed thought')
    expect(loadDraft('beta-22222222')).toBe('')
    clearDraft('alpha-11111111')
    expect(loadDraft('alpha-11111111')).toBe('')
  })
  test('projectKeyFor is stable and unique per folder', () => {
    expect(projectKeyFor('/a/projects/foo')).toBe(projectKeyFor('/a/projects/foo'))
    expect(projectKeyFor('/a/projects/foo')).not.toBe(projectKeyFor('/b/other/foo'))
    expect(projectKeyFor('')).toBe('default')
  })
  test('clearPromptHistory wipes everything', () => {
    addPrompt('gone', 'alpha-11111111')
    saveDraft('gone-draft', 'alpha-11111111')
    const cleared = clearPromptHistory()
    expect(cleared.history).toBeGreaterThanOrEqual(1)
    expect(loadPromptHistory('alpha-11111111')).toEqual([])
    expect(loadDraft('alpha-11111111')).toBe('')
  })
})
describe('session compaction pure helpers', () => {
  test('compactedMessageText starts with header and keeps summary', () => {
    const text = compactedMessageText('my summary')
    expect(text.startsWith(COMPACTION_HEADER)).toBe(true)
    expect(text).toContain('my summary')
  })
  test('isCompactionCut detects compaction metadata', () => {
    expect(isCompactionCut(undefined)).toBe(false)
    expect(isCompactionCut(textMessage('a', 'user', 'hi'))).toBe(false)
    const cut = {
      id: 'c',
      role: 'user',
      metadata: { compaction: { summary: 's', compactedMessageIds: [], createdAt: 1 } },
      parts: [{ type: 'text', text: 'cut' }],
    } as unknown as UIMessage
    expect(isCompactionCut(cut)).toBe(true)
  })
  test('messagesForLlm slices from last cut', () => {
    const plain = textMessage('a', 'user', 'first')
    const cut = {
      id: 'b',
      role: 'user',
      metadata: { compaction: { summary: 's', compactedMessageIds: ['a'], createdAt: 1 } },
      parts: [{ type: 'text', text: 'cut' }],
    } as unknown as UIMessage
    const after = textMessage('c', 'user', 'after')
    expect(messagesForLlm([plain, cut, after] as UIMessage[]).map((m) => m.id)).toEqual(['b', 'c'])
    expect(messagesForLlm([plain, after] as UIMessage[]).map((m) => m.id)).toEqual(['a', 'c'])
  })
  test('serializeForCompaction skips system and reasoning', () => {
    const messages = [
      textMessage('a', 'system', 'ignored'),
      textMessage('b', 'user', 'hello'),
      {
        id: 'c',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'think' },
          { type: 'text', text: 'answer' },
        ],
      } as unknown as UIMessage,
    ]
    const serialized = serializeForCompaction(messages as UIMessage[])
    expect(serialized).toContain('user: hello')
    expect(serialized).toContain('assistant: answer')
    expect(serialized).not.toContain('ignored')
    expect(serialized).not.toContain('think')
  })
  test('buildPlanHandoffCut keeps last user intent and plan', () => {
    const messages = [textMessage('a', 'user', 'first request'), textMessage('b', 'assistant', 'reply'), textMessage('c', 'user', 'latest request')]
    const cut = buildPlanHandoffCut({ messages: messages as UIMessage[], plan: 'do things', verdict: 'looks good' })
    expect(cut.text.startsWith(PLAN_HANDOFF_HEADER)).toBe(true)
    expect(cut.summary).toContain('latest request')
    expect(cut.summary).toContain('do things')
    expect(cut.summary).toContain('looks good')
    expect(cut.compactedMessageIds).toEqual(['a', 'b', 'c'])
  })
})
describe('CheckpointStore transitions', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-checkpoint-'))
    initLockDir(dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  test('starts with nothing to undo or redo', async () => {
    const store = new CheckpointStore(join(dir, 'empty.jsonl'))
    await store.load()
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
  })
  test('undo then redo round trip restores content', async () => {
    const target = join(dir, 'target.txt')
    const store = new CheckpointStore(join(dir, 'store.jsonl'))
    await store.record({ tool: 'write', path: target, before: null, after: 'next' })
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)
    await store.undo()
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(true)
    await store.redo()
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('next')
  })
  test('load skips corrupt lines and restores pointer', async () => {
    const path = join(dir, 'mixed.jsonl')
    const valid = JSON.stringify({ seq: 0, tool: 'write', path: join(dir, 'x.txt'), before: null, after: 'a' })
    await writeFile(path, `${valid}\nnot json\n{"seq":"bad"}\n\n`)
    const store = new CheckpointStore(path)
    await store.load()
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)
  })
})
describe('JobTracker rows and listeners', () => {
  test('set get and all track rows', () => {
    const tracker = new JobTracker()
    tracker.set({ sessionId: 'a', parentId: 'p', subagent: 'explorer', state: 'running', queued: true, startedAt: 1 })
    expect(tracker.get('a')?.subagent).toBe('explorer')
    expect(tracker.all()).toHaveLength(1)
  })
  test('patch merges and ignores unknown id', () => {
    const tracker = new JobTracker()
    let calls = 0
    tracker.onJobs(() => {
      calls += 1
    })
    tracker.patch('missing', { state: 'finished' })
    expect(calls).toBe(0)
    tracker.set({ sessionId: 'a', parentId: 'p', subagent: 'explorer', state: 'running', queued: true, startedAt: 1 })
    const before = calls
    tracker.patch('a', { state: 'finished', queued: false })
    expect(tracker.get('a')?.state).toBe('finished')
    expect(calls).toBe(before + 1)
  })
  test('delete emits and unsubscribe stops notifications', () => {
    const tracker = new JobTracker()
    const seen: number[] = []
    const off = tracker.onJobs((rows) => {
      seen.push(rows.length)
    })
    tracker.set({ sessionId: 'a', parentId: 'p', subagent: 'explorer', state: 'running', queued: false, startedAt: 1 })
    tracker.delete('a')
    expect(tracker.get('a')).toBeUndefined()
    expect(seen).toEqual([1, 0])
    off()
    tracker.set({ sessionId: 'b', parentId: 'p', subagent: 'explorer', state: 'running', queued: false, startedAt: 1 })
    expect(seen).toEqual([1, 0])
  })
})
