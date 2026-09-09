/**
 * Smoke test: windowed scrolling in SessionMessages.
 * Verifies that (1) wheel-scrolling up slides the window to older messages
 * without jumps, (2) scrolling back down catches up to the newest messages.
 * Run: bun scripts/smoke-message-scroll.tsx
 */
import { testRender } from "@opentui/solid"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const COUNT = 40
const messages: LoopMessage[] = Array.from({ length: COUNT }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? "user" : "assistant",
  parts: [{ type: "text", text: `msg-${String(i + 1).padStart(2, "0")} line-a line-b line-c` }],
}) as unknown as LoopMessage)

const testSetup = await testRender(() => <SessionMessages messages={messages} />, {
  width: 60,
  height: 20,
})
const { renderOnce, captureCharFrame, mockMouse, renderer } = testSetup

/** Message ids visible in a captured frame, in order. */
const visible = (frame: string) =>
  [...frame.matchAll(/msg-(\d+)/g)].map((m) => Number(m[1]!))

const isContiguous = (ids: number[]) => {
  const unique = [...new Set(ids)]
  return unique.every((v, i) => i === 0 || v === unique[i - 1]! + 1)
}

/** Let yoga layout + markdown parser workers settle, then capture. */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 60))
    await renderOnce()
  }
  return visible(captureCharFrame())
}

try {
  const initial = await settle()
  console.log("initial visible:", initial.join(","))
  if (!initial.length || !isContiguous(initial)) throw new Error("initial frame not contiguous")
  if (initial[initial.length - 1] !== COUNT) throw new Error("newest messages not shown initially")

  // One wheel-up at the bottom edge shifts the window by SCROLL_STEP; the
  // anchor compensation must keep some of the previously visible messages
  // on screen instead of replacing the whole view (the "jump" bug).
  await mockMouse.scroll(30, 10, "up")
  const afterOneUp = await settle()
  console.log("after one scroll-up:", afterOneUp.join(","))
  if (!afterOneUp.some((id) => initial.includes(id)))
    throw new Error("view jumped: no overlap with previously visible messages after shift")

  // Scroll up at the top edge repeatedly; the window must slide to older
  // messages while keeping the visible run contiguous.
  let afterUp: number[] = []
  for (let i = 0; i < 30; i++) {
    await mockMouse.scroll(30, 10, "up")
    afterUp = await settle()
  }
  console.log("after scroll-up:", afterUp.join(","))
  if (!afterUp.length || !isContiguous(afterUp)) throw new Error("scroll-up frame not contiguous")
  if (afterUp[0] !== 1) throw new Error(`did not reach oldest message, first visible: ${afterUp[0]}`)

  // Scroll back down; the window must catch up to the newest messages.
  let afterDown: number[] = []
  for (let i = 0; i < 30; i++) {
    await mockMouse.scroll(30, 10, "down")
    afterDown = await settle()
  }
  console.log("after scroll-down:", afterDown.join(","))
  if (!afterDown.length || !isContiguous(afterDown)) throw new Error("scroll-down frame not contiguous")
  if (afterDown[afterDown.length - 1] !== COUNT)
    throw new Error(`did not catch up to newest message, last visible: ${afterDown[afterDown.length - 1]}`)

  console.log("SMOKE OK")
} finally {
  renderer.destroy()
}
process.exit(0)
