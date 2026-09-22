import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createInteraction } from '../../src/auth/interaction.ts'

let logSpy: ReturnType<typeof spyOn> | undefined

const captureLogs = (): Array<string> => {
  const logs: Array<string> = []
  logSpy = spyOn(console, 'log').mockImplementation((...args: Array<unknown>) => {
    logs.push(args.map((arg) => String(arg)).join(' '))
  })
  return logs
}

afterEach(() => {
  logSpy?.mockRestore()
  logSpy = undefined
})

describe('createInteraction', () => {
  test('prints the browser URL for auth_url events', () => {
    const logs = captureLogs()
    const interaction = createInteraction('openai', 'OpenAI', new AbortController().signal)
    interaction.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize?x=1' })
    expect(logs.some((line) => line.includes('https://auth.example.com/authorize?x=1'))).toBe(true)
    expect(logs.some((line) => line.includes('Open this URL in your browser'))).toBe(true)
  })

  test('prints the verification URL for device_code events', () => {
    const logs = captureLogs()
    const interaction = createInteraction('github-copilot', 'GitHub Copilot', new AbortController().signal)
    interaction.notify({ type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresInSeconds: 900 })
    expect(logs.some((line) => line.includes('https://github.com/login/device'))).toBe(true)
    expect(logs.some((line) => line.includes('ABCD-1234'))).toBe(true)
    expect(logs.some((line) => line.includes('Open this URL in your browser'))).toBe(true)
  })

  test('does not spawn a browser process', () => {
    captureLogs()
    const spawnSpy = spyOn(Bun, 'spawn')
    const interaction = createInteraction('openai', 'OpenAI', new AbortController().signal)
    interaction.notify({ type: 'auth_url', url: 'https://auth.example.com/authorize' })
    interaction.notify({ type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })
    expect(spawnSpy).not.toHaveBeenCalled()
    spawnSpy.mockRestore()
  })
})
