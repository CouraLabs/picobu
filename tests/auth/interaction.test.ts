import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createInteraction } from '../../src/auth/interaction.ts'

let logSpy: ReturnType<typeof spyOn> | undefined
let restoreSpawn: (() => void) | undefined

const captureLogs = (): Array<string> => {
  const logs: Array<string> = []
  logSpy = spyOn(console, 'log').mockImplementation((...args: Array<unknown>) => {
    logs.push(args.map((arg) => String(arg)).join(' '))
  })
  const runtime = Bun as unknown as { spawn: unknown }
  const originalSpawn = runtime.spawn
  runtime.spawn = () => ({ unref() {} })
  restoreSpawn = () => {
    runtime.spawn = originalSpawn
  }
  return logs
}

afterEach(() => {
  logSpy?.mockRestore()
  logSpy = undefined
  restoreSpawn?.()
  restoreSpawn = undefined
})

describe('createInteraction', () => {
  test('prints the browser URL for auth_url events', () => {
    const logs = captureLogs()
    const interaction = createInteraction('openai', 'OpenAI', new AbortController().signal)
    interaction.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize?x=1' })
    expect(logs.some((line) => line.includes('https://auth.example.com/authorize?x=1'))).toBe(true)
  })

  test('prints the verification URL for device_code events', () => {
    const logs = captureLogs()
    const interaction = createInteraction('github-copilot', 'GitHub Copilot', new AbortController().signal)
    interaction.notify({ type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresInSeconds: 900 })
    expect(logs.some((line) => line.includes('https://github.com/login/device'))).toBe(true)
    expect(logs.some((line) => line.includes('ABCD-1234'))).toBe(true)
  })
})
