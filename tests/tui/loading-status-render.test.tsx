import { describe, expect, test } from 'bun:test'
import { testRender } from '@opentui/solid'
import 'opentui-spinner/solid'
import { emptyUsage, zeroCost } from '../../src/agent/loop/loop-cost.ts'
import type { SessionStatusItem } from '../../src/config/session-layout.ts'
import { StatusItemView, type StatusRenderContext } from '../../src/tui/components/session/status/status-items.tsx'
import { StatusLines } from '../../src/tui/components/session/status/status-lines.tsx'
import { createSessionStatusData, type SessionStatusProps } from '../../src/tui/components/session/status/status-meta.ts'

const ctxFor = (stepCount: number): StatusRenderContext => {
  const status: SessionStatusProps = {
    agentId: 'coder',
    modelKey: undefined,
    thinking: undefined,
    title: undefined,
    cwd: undefined,
    git: null,
    messages: [],
    streaming: true,
    statsMetrics: { performance: undefined, warnings: undefined, headers: undefined, finishReason: undefined, endpoints: undefined, usage: emptyUsage(), stepCount, cost: zeroCost() },
  }
  return { status, data: createSessionStatusData(status), providerExtras: () => [], selectable: false }
}

const mount = async (previousItem: 'agent' | 'model') => {
  const setup = await testRender(() => <StatusItemView item="loading" ctx={ctxFor(1)} previousItem={previousItem} />, { width: 40, height: 3 })
  await setup.renderOnce()
  await setup.flush()
  return setup
}

const mountLines = async (line: Array<SessionStatusItem>) => {
  const setup = await testRender(() => <StatusLines layout={{ lines: [line], columnGap: 1, rowGap: 0 }} ctx={ctxFor(1)} />, { width: 60, height: 3 })
  await setup.renderOnce()
  await setup.flush()
  return setup
}

describe('loading status adjacency', () => {
  test('shows the agent-prefixed verb when placed right after the agent', async () => {
    const setup = await mount('agent')
    try {
      expect(setup.captureCharFrame()).toContain('is ')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('shows only the spinner when not next to the agent', async () => {
    const setup = await mount('model')
    try {
      expect(setup.captureCharFrame()).not.toContain('is ')
    } finally {
      setup.renderer.destroy()
    }
  })
})

describe('loading adjacency through StatusLines', () => {
  test('renders the verb text when loading directly follows the agent', async () => {
    const setup = await mountLines(['agent', 'loading'])
    try {
      expect(setup.captureCharFrame()).toContain('is ')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('renders the bare spinner when a separator sits between agent and loading', async () => {
    const setup = await mountLines(['agent', 'separator', 'loading'])
    try {
      expect(setup.captureCharFrame()).not.toContain('is ')
    } finally {
      setup.renderer.destroy()
    }
  })
})
