import { describe, expect, test } from 'bun:test'
import { onPromptFocusRequest, requestPromptFocus } from '../../src/tui/hooks/prompt-focus.ts'

describe('prompt focus bus', () => {
  test('requestPromptFocus invokes registered listener', () => {
    let calls = 0
    const off = onPromptFocusRequest(() => {
      calls += 1
    })
    requestPromptFocus()
    expect(calls).toBe(1)
    off()
  })

  test('unregistered listener is not invoked', () => {
    let calls = 0
    const off = onPromptFocusRequest(() => {
      calls += 1
    })
    off()
    requestPromptFocus()
    expect(calls).toBe(0)
  })

  test('all listeners are invoked in registration order', () => {
    const order: Array<string> = []
    const offA = onPromptFocusRequest(() => order.push('a'))
    const offB = onPromptFocusRequest(() => order.push('b'))
    requestPromptFocus()
    expect(order).toEqual(['a', 'b'])
    offA()
    offB()
  })

  test('a throwing listener does not block later listeners', () => {
    const order: Array<string> = []
    const offA = onPromptFocusRequest(() => {
      order.push('a')
      throw new Error('focus failed')
    })
    const offB = onPromptFocusRequest(() => order.push('b'))
    expect(() => requestPromptFocus()).not.toThrow()
    expect(order).toEqual(['a', 'b'])
    offA()
    offB()
  })
})
