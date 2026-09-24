import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { cacheUserPrompts, extractUserPrompt, messageFileParts, messageTextParts, planRevert, stripAnalysedImages, type UserPromptSnapshot } from '../../src/agent/sessions/session-messages.ts'

const textPart = (text: string) => ({ type: 'text' as const, text })
const filePart = (mediaType: string, filename: string, url: string) => ({ type: 'file' as const, mediaType, filename, url })

function userMessage(id: string, parts: Array<unknown>): UIMessage {
  return { id, role: 'user', parts } as unknown as UIMessage
}

function assistantMessage(id: string, parts: Array<unknown>): UIMessage {
  return { id, role: 'assistant', parts } as unknown as UIMessage
}

describe('message part helpers', () => {
  test('messageTextParts joins text parts', () => {
    expect(messageTextParts(userMessage('a', [textPart('a'), textPart('b')]))).toBe('a\nb')
  })
  test('messageFileParts extracts file parts', () => {
    expect(messageFileParts(userMessage('a', [filePart('image/png', 'p.png', 'data:image/png;base64,AA==')]))).toEqual([
      { mediaType: 'image/png', filename: 'p.png', url: 'data:image/png;base64,AA==' },
    ])
  })
  test('extractUserPrompt combines text and files', () => {
    const message = userMessage('a', [textPart('[1 image/png 10B] look'), filePart('image/png', 'p.png', 'data:image/png;base64,AA==')])
    expect(extractUserPrompt(message)).toEqual({
      text: '[1 image/png 10B] look',
      files: [{ mediaType: 'image/png', filename: 'p.png', url: 'data:image/png;base64,AA==' }],
    })
  })
})

describe('planRevert', () => {
  const messages = [userMessage('a', [textPart('a')]), assistantMessage('b', [textPart('b')]), userMessage('c', [textPart('c')]), assistantMessage('d', [textPart('d')])]
  test('user message cuts at that index', () => {
    expect(planRevert(messages, 'c')).toEqual({ cut: 2, isUser: true })
  })
  test('assistant message keeps it', () => {
    expect(planRevert(messages, 'b')).toEqual({ cut: 2, isUser: false })
    expect(planRevert(messages, 'd')).toEqual({ cut: 4, isUser: false })
  })
  test('unknown id returns undefined', () => {
    expect(planRevert(messages, 'zz')).toBeUndefined()
  })
  test('compaction marker is not treated as an editable user prompt', () => {
    const marker = { id: 'm', role: 'user', metadata: { compaction: { tokensBefore: 1 } }, parts: [textPart('summary')] } as unknown as UIMessage
    const list = [userMessage('a', [textPart('a')]), marker, assistantMessage('b', [textPart('b')])]
    expect(planRevert(list, 'm')).toEqual({ cut: 2, isUser: false })
  })
})

describe('cacheUserPrompts', () => {
  test('records only user messages with files and never overwrites', () => {
    const cache = new Map<string, UserPromptSnapshot>()
    const a = userMessage('a', [textPart('one'), filePart('image/png', 'p.png', 'data:image/png;base64,AA==')])
    const b = assistantMessage('b', [filePart('image/png', 'p.png', 'data:image/png;base64,BB==')])
    const c = userMessage('c', [textPart('two')])
    cacheUserPrompts([a, b, c], cache)
    expect([...cache.keys()]).toEqual(['a'])
    const mutated = userMessage('a', [textPart('changed'), filePart('image/png', 'p.png', 'data:image/png;base64,CC==')])
    cacheUserPrompts([mutated], cache)
    expect(cache.get('a')?.text).toBe('one')
  })

  test('cached snapshot survives image stripping', () => {
    const cache = new Map<string, UserPromptSnapshot>()
    const a = userMessage('a', [textPart('[1 image/png 10B] look'), filePart('image/png', 'p.png', 'data:image/png;base64,AA==')])
    cacheUserPrompts([a], cache)
    const stripped = stripAnalysedImages([a])
    const first = stripped[0]
    expect(first ? messageFileParts(first) : []).toHaveLength(0)
    expect(cache.get('a')?.files).toEqual([{ mediaType: 'image/png', filename: 'p.png', url: 'data:image/png;base64,AA==' }])
  })
})
