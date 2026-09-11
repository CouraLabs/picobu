import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { settleStreamingParts } from '../../src/agent/sessions/session-messages.ts'
import { clearStreamBackup, readStreamBackup, recoverStreamBackup, streamBackupPath, writeStreamBackup } from '../../src/agent/sessions/session-stream-backup.ts'
import { options } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const originalSystemDir = options.app.systemDir

const userMessage = (id: string, text: string): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] }) as unknown as UIMessage

const streamingAssistant = (id: string): UIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [
      { type: 'text', text: 'partial', state: 'streaming' },
      { type: 'tool-read', toolCallId: 't1', state: 'input-available', input: { path: 'a' } },
    ],
  }) as unknown as UIMessage

describe('stream backup io', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-stream-'))
    options.app.systemDir = dir
    initLockDir(dir)
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
  })
  test('missing file reads as undefined', async () => {
    expect(await readStreamBackup('folder', 'absent')).toBeUndefined()
  })
  test('write then read round trip', async () => {
    const messages = [userMessage('a', 'hello'), streamingAssistant('b')]
    await writeStreamBackup('folder', 's1', messages)
    const loaded = await readStreamBackup('folder', 's1')
    expect(loaded).toHaveLength(2)
    expect(loaded?.[0]?.id).toBe('a')
    expect(loaded?.[1]?.id).toBe('b')
  })
  test('clear removes the file', async () => {
    await writeStreamBackup('folder', 's1', [userMessage('a', 'hello')])
    await clearStreamBackup('folder', 's1')
    expect(await readStreamBackup('folder', 's1')).toBeUndefined()
  })
  test('recover settles in-flight parts for reload', async () => {
    await writeStreamBackup('folder', 's1', [userMessage('a', 'hello'), streamingAssistant('b')])
    const recovered = await recoverStreamBackup('folder', 's1')
    expect(recovered).toHaveLength(2)
    const assistant = recovered?.[1]
    const text = assistant?.parts.find((p) => p.type === 'text') as { state?: string } | undefined
    expect(text?.state).toBe('done')
    const tool = assistant?.parts.find((p) => (p as { toolCallId?: string }).toolCallId === 't1') as { state?: string } | undefined
    expect(tool?.state).toBe('output-error')
  })
  test('recover returns undefined when no backup exists', async () => {
    expect(await recoverStreamBackup('folder', 'absent')).toBeUndefined()
  })
  test('backup path lives next to the session file', () => {
    expect(streamBackupPath('folder', 's1').endsWith(join('folder', 's1.stream.json'))).toBe(true)
  })
})

describe('settleStreamingParts', () => {
  test('finalizes streaming text and reasoning, leaves the rest alone', () => {
    const settled = settleStreamingParts([
      {
        id: 'a',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'partial', state: 'streaming' },
          { type: 'text', text: 'final', state: 'done' },
          { type: 'reasoning', text: 'thinking', state: 'streaming' },
          { type: 'tool-read', toolCallId: 't1', state: 'input-available', input: {} },
        ],
      } as unknown as UIMessage,
    ])
    const states = settled[0]?.parts.map((p) => (p as { state?: string }).state)
    expect(states).toEqual(['done', 'done', 'done', 'input-available'])
  })
  test('returns the same reference when nothing is streaming', () => {
    const messages = [userMessage('a', 'hello')]
    expect(settleStreamingParts(messages)).toBe(messages)
  })
})
