import { describe, expect, test } from 'bun:test'
import { testRender } from '@opentui/solid'
import { PlanReview } from '../../src/tui/components/session/tools/plan-review.tsx'
import { KeyboardProvider } from '../../src/tui/hooks/keyboard-provider.tsx'

const mount = async (plan: string) => {
  const setup = await testRender(
    () => (
      <KeyboardProvider>
        <PlanReview plan={plan} status="pending" interactive onVerdict={() => {}} onCancel={() => {}} />
      </KeyboardProvider>
    ),
    { width: 60, height: 20 },
  )
  await setup.renderOnce()
  await setup.flush()
  return setup
}

describe('PlanReview render', () => {
  test('renders a fenced code block as one unit without fence rails', async () => {
    const setup = await mount('# Title\n```ts\nconst a = 1\nconst b = 2\n```\nDone')
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain('const a = 1')
      expect(frame).toContain('const b = 2')
      expect(frame).toContain('Click on the pencil or block to add a comment')
      expect(frame).not.toContain('```ts')
      expect(frame).not.toContain('```')
    } finally {
      setup.renderer.destroy()
    }
  })

  test('renders an empty plan without crashing', async () => {
    const setup = await mount('')
    try {
      expect(setup.captureCharFrame()).toContain('Approve')
    } finally {
      setup.renderer.destroy()
    }
  })
})
