import { afterEach, describe, expect, test } from 'bun:test'
import { isLoadingAdjacentToAgent, LOADING_VERBS, pickLoadingVerb } from '../../src/tui/components/session/status/loading-verbs.ts'

describe('pickLoadingVerb', () => {
  const original = Math.random
  afterEach(() => {
    Math.random = original
  })

  test('returns the first verb when Math.random is 0', () => {
    Math.random = () => 0
    expect(LOADING_VERBS.indexOf(pickLoadingVerb())).toBe(0)
  })

  test('returns the last verb when Math.random is near 1', () => {
    Math.random = () => 0.999999
    expect(LOADING_VERBS.indexOf(pickLoadingVerb())).toBe(LOADING_VERBS.length - 1)
  })

  test('always returns a member of the list', () => {
    for (let i = 0; i < 50; i += 1) expect(LOADING_VERBS).toContain(pickLoadingVerb())
  })
})

describe('isLoadingAdjacentToAgent', () => {
  test('is true only when the previous rendered item is agent', () => {
    expect(isLoadingAdjacentToAgent('agent')).toBe(true)
    expect(isLoadingAdjacentToAgent('model')).toBe(false)
    expect(isLoadingAdjacentToAgent('separator')).toBe(false)
    expect(isLoadingAdjacentToAgent(undefined)).toBe(false)
  })
})
