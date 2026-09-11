/**
 * Smoke test: the status bar renders agent name, provider/model, token usage,
 * cache hit and cost from the latest message metadata; the spinner only shows
 * while streaming. Run: bun scripts/smoke-session-status.tsx
 */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { emptyTotals } from "@agent/sessions/session-meta.ts"
import { SessionStatus } from "@tui/components/session/session-status.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const usageMessage = {
  id: "a1",
  role: "assistant",
  metadata: {
    usage: { inputTokens: 12000, outputTokens: 4500, cacheReadTokens: 9600, cacheWriteTokens: 1000 },
    cost: 0.0421,
  },
  parts: [{ type: "text", text: "done" }],
} as unknown as LoopMessage

const baseTotals = emptyTotals()
const totals = {
  ...baseTotals,
  computed: { ...baseTotals.computed, accNoCacheInputTokens: 12_000, accOutputTokens: 4_500 },
}

const [streaming, setStreaming] = createSignal(false)

const testSetup = await testRender(
  () => (
    <SessionStatus
      agentId="coder"
      modelKey="anthropic/claude-sonnet-4-5"
      thinking="medium"
      messages={[usageMessage]}
      totals={totals}
      streaming={streaming()}
    />
  ),
  { width: 100, height: 3 },
)
const { renderOnce, captureCharFrame, renderer } = testSetup

try {
const hasSpinnerFrame = (frame: string): boolean =>
  [...frame].some((ch) => ch >= "⠀" && ch <= "⣿")

  await renderOnce()
  const idle = captureCharFrame()
  console.log("=== idle ===")
  console.log(idle)
  console.log(idle.includes("Coder") ? "PASS: agent name" : "FAIL: agent name missing")
  console.log(idle.includes("12K") ? "PASS: input tokens" : "FAIL: input tokens missing")
  console.log(idle.includes("4.5K") ? "PASS: output tokens" : "FAIL: output tokens missing")
  console.log(idle.includes("(80%)") ? "PASS: cache hit" : "FAIL: cache hit missing")
  console.log(idle.includes("$ 0.04") ? "PASS: cost" : "FAIL: cost missing")

  setStreaming(true)
  await Bun.sleep(300)
  await renderOnce()
  const running = captureCharFrame()
  console.log("=== streaming ===")
  console.log(running)
  console.log(hasSpinnerFrame(running) ? "PASS: spinner visible while streaming" : "FAIL: spinner missing")

  setStreaming(false)
  await renderOnce()
  const stopped = captureCharFrame()
  console.log(!hasSpinnerFrame(stopped) ? "PASS: spinner hidden when idle" : "FAIL: spinner still visible")
} finally {
  // The renderer owns native timers; without destroy() the process never exits.
  renderer.destroy()
}
process.exit(0)
