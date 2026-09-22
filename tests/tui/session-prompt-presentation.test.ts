import { describe, expect, test } from 'bun:test'
import { resolvePromptFieldPresentation } from '../../src/tui/components/session/session-prompt.tsx'

const base = { waiting: false, queue: false, steering: false, shell: false, command: false, queueDepth: 0 }

describe('resolvePromptFieldPresentation', () => {
  test('normal prompt', () => expect(resolvePromptFieldPresentation(base)).toEqual({ title: ' Prompt ', tone: 'muted' }))
  test('shell mode uses secondary with Shell title', () => expect(resolvePromptFieldPresentation({ ...base, shell: true })).toEqual({ title: ' Shell ', tone: 'secondary' }))
  test('command uses accent', () => expect(resolvePromptFieldPresentation({ ...base, command: true })).toEqual({ title: ' Command ', tone: 'accent' }))
  test('waiting and queue use info', () => {
    expect(resolvePromptFieldPresentation({ ...base, waiting: true })).toEqual({ title: ' Prompt - Waiting ', tone: 'info' })
    expect(resolvePromptFieldPresentation({ ...base, queue: true, queueDepth: 2 })).toEqual({ title: ' Prompt - Enqueue (2) ', tone: 'info' })
  })
  test('steering uses error and outranks shell', () => expect(resolvePromptFieldPresentation({ ...base, steering: true, shell: true })).toEqual({ title: ' Prompt Steering ', tone: 'error' }))
})
