import { describe, expect, test } from 'bun:test'
import { withTimeout } from '../../src/shared/with-timeout.ts'

describe('withTimeout', () => {
  test('resolves with the task value before the deadline', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'fast')).resolves.toBe(42)
  })

  test('rejects with the label when the task hangs', async () => {
    const hanging = new Promise<string>(() => {})
    await expect(withTimeout(hanging, 10, 'parsers')).rejects.toThrow('parsers timed out after 10ms')
  })

  test('propagates task rejection before the deadline', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'failing')).rejects.toThrow('boom')
  })

  test('does not keep the process alive after settling', async () => {
    await withTimeout(Promise.resolve('ok'), 60_000, 'unref')
  })
})
