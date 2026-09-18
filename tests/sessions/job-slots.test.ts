import { describe, expect, test } from 'bun:test'
import { JobTracker } from '../../src/agent/sessions/session-jobs.ts'

describe('JobTracker slot cap', () => {
  test('concurrent acquires never exceed maxAgents', async () => {
    const tracker = new JobTracker()
    const max = 2
    let running = 0
    let peak = 0
    const work = async () => {
      await tracker.acquireSlot(max)
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      tracker.releaseSlot()
    }
    await Promise.all(Array.from({ length: 10 }, () => work()))
    expect(peak).toBe(max)
    expect(tracker.activeSlots).toBe(0)
  })

  test('acquire resolves in FIFO order when slots free up', async () => {
    const tracker = new JobTracker()
    const order: Array<number> = []
    await tracker.acquireSlot(1)
    const first = tracker.acquireSlot(1).then(() => order.push(1))
    const second = tracker.acquireSlot(1).then(() => order.push(2))
    tracker.releaseSlot()
    tracker.releaseSlot()
    await Promise.all([first, second])
    expect(order).toEqual([1, 2])
    expect(tracker.activeSlots).toBe(1)
  })
})
