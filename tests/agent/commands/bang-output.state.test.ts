import { describe, expect, it } from 'bun:test'
import type { BangOutput } from '../../../src/states/bang-output.state.ts'
import { bangOutput, clearBangOutput, setBangOutput } from '../../../src/states/bang-output.state.ts'

const makeItem = (id: number): BangOutput => ({
  id,
  command: '!ls -la',
  cwd: '/tmp',
  exitCode: 0,
  stdout: 'total 0',
  stderr: '',
  truncated: false,
  durationMs: 12,
  startedAt: Date.now(),
})

describe('bang-output.state', () => {
  it('initial state is null', () => {
    clearBangOutput()
    expect(bangOutput()).toBeNull()
  })

  it('setBangOutput stores the item', () => {
    clearBangOutput()
    const item = makeItem(1)
    setBangOutput(item)
    expect(bangOutput()).toEqual(item)
    clearBangOutput()
  })

  it('clearBangOutput resets to null', () => {
    setBangOutput(makeItem(2))
    expect(bangOutput()).not.toBeNull()
    clearBangOutput()
    expect(bangOutput()).toBeNull()
  })
})
