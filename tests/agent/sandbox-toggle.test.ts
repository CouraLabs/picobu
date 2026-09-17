import { describe, expect, test } from 'bun:test'
import { type SandboxAgent, withSandbox } from '../../src/agent/loop/sandbox-agent.ts'

interface CapturedCallOptions {
  experimental_sandbox?: unknown
}

const fakeAgent = (captured: Array<CapturedCallOptions>): SandboxAgent =>
  ({
    id: 'fake-agent',
    tools: {},
    stream: async (callOptions: CapturedCallOptions) => {
      captured.push(callOptions)
      return {}
    },
    generate: async (callOptions: CapturedCallOptions) => {
      captured.push(callOptions)
      return {}
    },
  }) as unknown as SandboxAgent

describe('withSandbox', () => {
  test('omits experimental_sandbox when disabled', async () => {
    const captured: Array<CapturedCallOptions> = []
    const agent = withSandbox(fakeAgent(captured), '/tmp', () => false)
    await agent.generate({} as never)
    await agent.stream({} as never)
    expect(captured.length).toBe(2)
    for (const options of captured) expect('experimental_sandbox' in options).toBe(false)
  })

  test('attaches the same session instance when enabled', async () => {
    const captured: Array<CapturedCallOptions> = []
    const agent = withSandbox(fakeAgent(captured), '/tmp', () => true)
    await agent.generate({} as never)
    await agent.stream({} as never)
    expect(captured.length).toBe(2)
    const first = captured[0]?.experimental_sandbox
    expect(first).toBeDefined()
    for (const options of captured) expect(options.experimental_sandbox).toBe(first)
  })

  test('flipping enabled between calls changes attachment', async () => {
    let enabled = true
    const captured: Array<CapturedCallOptions> = []
    const agent = withSandbox(fakeAgent(captured), '/tmp', () => enabled)
    await agent.generate({} as never)
    enabled = false
    await agent.generate({} as never)
    expect('experimental_sandbox' in (captured[0] ?? {})).toBe(true)
    expect('experimental_sandbox' in (captured[1] ?? {})).toBe(false)
  })
})
