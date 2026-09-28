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
  test.each([
    ['agent-adjacent direct', 'agent' as const, ['agent'], true],
    ['agent-adjacent through StatusLines', 'model' as const, ['agent', 'loading'], true],
    ['non-adjacent direct', 'model' as const, ['model'], false],
    ['non-adjacent across separator', 'model' as const, ['agent', 'separator', 'loading'], false],
  ] as Array<[string, 'agent' | 'model', Array<SessionStatusItem>, boolean]>)('loading %s shows the verb only when adjacent', async (_label, previousItem, line, adjacent) => {
    const setup = line.length === 1 ? await mount(previousItem) : await mountLines(line)
    try {
      const frame = setup.captureCharFrame()
      if (adjacent) expect(frame).toContain('is ')
      else expect(frame).not.toContain('is ')
    } finally {
      setup.renderer.destroy()
    }
  })
})
