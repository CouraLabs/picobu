import { describe, expect, test } from 'bun:test'
import { MarkdownRenderable, type Renderable } from '@opentui/core'
import { testRender } from '@opentui/solid'
import { PlanReview } from '../../src/tui/components/session/tools/plan-review.tsx'
import { KeyboardProvider } from '../../src/tui/hooks/keyboard-provider.tsx'

const collectMarkdowns = (node: Renderable): Array<MarkdownRenderable> => {
  const found: Array<MarkdownRenderable> = []
  for (const child of node.getChildren()) {
    if (child instanceof MarkdownRenderable) found.push(child)
    found.push(...collectMarkdowns(child))
  }
  return found
}

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

  test('shows Approved exactly once for a comment-free approval', async () => {
    const setup = await testRender(
      () => (
        <KeyboardProvider>
          <PlanReview plan="do the thing" status="approved" outputMessage="Approved" interactive={false} onVerdict={() => {}} onCancel={() => {}} />
        </KeyboardProvider>
      ),
      { width: 60, height: 20 },
    )
    try {
      await setup.renderOnce()
      await setup.flush()
      const frame = setup.captureCharFrame()
      expect(frame.split('Approved').length - 1).toBe(1)
    } finally {
      setup.renderer.destroy()
    }
  })

  test('clips segment content so a block cannot bleed into the next', async () => {
    const plan = `# Heading\n${'wrapline '.repeat(40)}\n\n## Following\nMARKER_FOLLOWING`
    const setup = await mount(plan)
    try {
      const markdowns = collectMarkdowns(setup.renderer.root)
      expect(markdowns.length).toBeGreaterThan(0)
      for (const markdown of markdowns) expect(markdown.parent?.overflow).toBe('hidden')
    } finally {
      setup.renderer.destroy()
    }
  })
})
