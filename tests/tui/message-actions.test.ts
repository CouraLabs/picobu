import { describe, expect, test } from 'bun:test'
import { revertConfirmCopy } from '../../src/tui/components/session/message-actions.tsx'

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
