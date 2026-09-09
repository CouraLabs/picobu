/**
 * Smoke test: verifies the TUI re-renders a tool part when the AI SDK's UI
 * message stream mutates the same part object in place (preliminary updates),
 * e.g. the shell tool's live terminal output while a command runs.
 * Run: bun scripts/smoke-shell-stream.tsx
 */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

// Simulates readUIMessageStream: one message object, mutated in place.
const assistant: LoopMessage = {
  id: "a1",
  role: "assistant",
  parts: [
    {
      type: "tool-shell",
      state: "output-available",
      preliminary: true,
      input: { command: `for i in 1 2 3; do echo "step $i"; sleep 5; done` },
      output: { progress: "step 1" },
    },
  ],
} as unknown as LoopMessage

const [messages, setMessages] = createSignal<LoopMessage[]>([
  { id: "u1", role: "user", parts: [{ type: "text", text: "run the loop" }] } as LoopMessage,
  assistant,
])

const testSetup = await testRender(
  () => <SessionMessages messages={messages()} isStreaming />,
  { width: 80, height: 20 },
)
const { renderOnce, captureCharFrame, renderer } = testSetup

try {
  await renderOnce()
  const frame1 = captureCharFrame()

  // The stream mutates the part in place and re-yields the same message;
  // SessionPage swaps the message into a NEW array (same object references).
  ;(assistant.parts[0] as any).output = { progress: "step 1\nstep 2" }
  setMessages((prev) => prev.map((m) => (m.id === assistant.id ? assistant : m)))
  await renderOnce()
  const frame2 = captureCharFrame()

  console.log("=== frame 1 (before update) ===")
  console.log(frame1)
  console.log("=== frame 2 (after in-place update) ===")
  console.log(frame2)
  console.log(frame2.includes("step 2") ? "PASS: progress re-rendered" : "FAIL: progress NOT re-rendered")
} finally {
  // The renderer owns native timers; without destroy() the process never exits.
  renderer.destroy()
}
process.exit(0)
