/**
 * Temporary smoke test: verifies that a cloned tool part (simulating a stream
 * chunk) updates the rendered ToolPart without remounting the subtree.
 * Run: bun scripts/smoke-tool-part-update.tsx
 */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const baseMessage: LoopMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    { type: "tool-websearch", state: "input-streaming", input: { query: "bun test" } },
  ],
} as unknown as LoopMessage

const [messages, setMessages] = createSignal<LoopMessage[]>([baseMessage])

const testSetup = await testRender(
  () => <SessionMessages messages={messages()} />,
  { width: 60, height: 10 },
)
const { renderOnce, captureCharFrame, renderer } = testSetup

try {
  await renderOnce()
  console.log("--- initial (running) ---")
  console.log(captureCharFrame())

  // Simulate a stream chunk: same message/parts array, shallow-cloned part with
  // a preliminary progress output — exactly what session-messages clones for.
  setMessages([
    {
      ...baseMessage,
      parts: [
        { ...(baseMessage.parts[0] as object), state: "output-available", preliminary: true, output: { progress: "Fetching results 5–8 of 10…", results: [] } },
      ],
    } as unknown as LoopMessage,
  ])
  await renderOnce()
  console.log("--- after chunk (progress visible?) ---")
  console.log(captureCharFrame())

  setMessages([
    {
      ...baseMessage,
      parts: [
        { ...(baseMessage.parts[0] as object), state: "output-available", output: { results: [{}, {}, {}] } },
      ],
    } as unknown as LoopMessage,
  ])
  await renderOnce()
  console.log("--- after final output (success + summary?) ---")
  console.log(captureCharFrame())
} finally {
  // The renderer owns native timers; without destroy() the process never exits.
  renderer.destroy()
}
process.exit(0)
