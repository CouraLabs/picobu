import { describe, expect, test } from 'bun:test'
import { resolvePromptFieldPresentation, resolvePromptPlaceholder } from '../../src/tui/components/session/session-prompt.tsx'

const base = { waiting: false, queue: false, steering: false, shell: false, command: false, queueDepth: 0 }
const placeholderBase = { waiting: false, queue: false, steering: false, firstRun: false }

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

describe('resolvePromptPlaceholder', () => {
  test('shows greeting when firstRun and no mode is active', () => expect(resolvePromptPlaceholder({ ...placeholderBase, firstRun: true })).toBe('What are we going to build?'))
  test('returns empty when session is not empty', () => expect(resolvePromptPlaceholder(placeholderBase)).toBe(''))
  test('waiting outranks firstRun', () => expect(resolvePromptPlaceholder({ ...placeholderBase, waiting: true, firstRun: true })).toBe('Answer the questions above…'))
  test('queue outranks firstRun', () => expect(resolvePromptPlaceholder({ ...placeholderBase, queue: true, firstRun: true })).toBe('Enqueued until the run finishes…'))
  test('steering outranks firstRun', () => expect(resolvePromptPlaceholder({ ...placeholderBase, steering: true, firstRun: true })).toBe('Steer the running step…'))
})
