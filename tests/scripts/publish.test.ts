import { describe, expect, test } from 'bun:test'
import { runStep } from '../../scripts/publish.ts'

describe('runStep', () => {
  test('passes through when the command succeeds', () => {
    expect(() => runStep(['bun', '--version'], 'bun version')).not.toThrow()
  })

  test('throws when the command fails so publish stops', () => {
    expect(() => runStep(['bun', 'run', 'no-such-script-xyz'], 'missing script')).toThrow('missing script')
  })
})
