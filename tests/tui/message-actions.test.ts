import { describe, expect, test } from 'bun:test'
import { messageText, revertConfirmCopy } from '../../src/tui/components/session/message-actions.tsx'

describe('revertConfirmCopy', () => {
  test('assistant copy is unchanged', () => {
    expect(revertConfirmCopy('assistant')).toEqual({
      title: 'Revert to this message?',
      body: 'Discards every message after this one from the context. This cannot be undone.',
      confirm: 'Revert',
    })
  })
  test('user copy talks about returning to the prompt', () => {
    const copy = revertConfirmCopy('user')
    expect(copy.title).toBe('Edit this message?')
    expect(copy.confirm).toBe('Edit')
    expect(copy.body).toContain('prompt')
  })
})

describe('messageText', () => {
  const message = (parts: Array<{ type: string; text: string }>) => ({ id: 'm1', role: 'assistant', parts }) as never

  test('copies only the provided text part', () => {
    expect(
      messageText(
        message([
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ]),
        { type: 'text', text: 'b' } as never,
      ),
    ).toBe('b')
  })

  test('copies the provided reasoning part text', () => {
    expect(
      messageText(
        message([
          { type: 'reasoning', text: 'think' },
          { type: 'text', text: 'answer' },
        ]),
        { type: 'reasoning', text: 'think' } as never,
      ),
    ).toBe('think')
  })

  test('falls back to all text parts when no part is given', () => {
    expect(
      messageText(
        message([
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ]),
      ),
    ).toBe('a\nb')
  })
})
