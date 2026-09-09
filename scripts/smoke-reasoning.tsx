/**
 * Temporary smoke test: renders reasoning parts through SessionMessages with
 * mock messages and prints captured char frames: the collapsed headers
 * (`Reasoning...` / `Thought - <time>`), click-to-uncollapse, and the shell
 * tool output preview. Run: bun scripts/smoke-reasoning.tsx
 */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const sleep = (ms: number) => Bun.sleep(ms)

const reasoningText =
  "The user wants the reasoning block collapsed. I should keep the header short and mute the body."

const streamingReasoningPart = { type: "reasoning", state: "streaming", text: reasoningText }
const finishedReasoningPart = { type: "reasoning", text: reasoningText }

// While streaming, the reasoning part is the newest part of the turn.
const [messages, setMessages] = createSignal<LoopMessage[]>([
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "why is it called a pointer?" }],
  } as LoopMessage,
  {
    id: "a1",
    role: "assistant",
    parts: [streamingReasoningPart as never],
  } as unknown as LoopMessage,
])
const [streaming, setStreaming] = createSignal(true)

const testSetup = await testRender(
  () => <SessionMessages messages={messages()} isStreaming={streaming()} />,
  { width: 60, height: 20 },
)
const { renderOnce, captureCharFrame, renderer, mockMouse, waitForFrame } = testSetup

const frameRow = (frame: string, needle: string): number =>
  frame.split("\n").findIndex((row) => row.includes(needle))

try {
  console.log("--- streaming tail is reasoning: header only ---")
  await waitForFrame((frame) => frame.includes("Thinking"))
  // Let async markdown measuring settle so click coordinates are stable.
  await testSetup.waitForVisualIdle()
  const frame1 = captureCharFrame()
  console.log(frame1)

  console.log("--- click on the reasoning header: uncollapses ---")
  const headerRow = frameRow(frame1, "Thinking")
  await mockMouse.click(10, headerRow)
  await renderOnce()
  console.log(captureCharFrame())

  console.log("--- stream finished: header becomes Thoughts ---")
  await sleep(1_200)
  setStreaming(false)
  setMessages([
    ...messages().slice(0, 1),
    {
      id: "a1",
      role: "assistant",
      parts: [
        finishedReasoningPart as never,
        { type: "text", text: "All done." },
      ],
    } as unknown as LoopMessage,
  ])
  const frame3 = await waitForFrame((frame) => frame.includes("Thoughts"))
  console.log(frame3)

  console.log("--- click again: collapses ---")
  await mockMouse.click(10, frameRow(frame3, "Thoughts"))
  await renderOnce()
  console.log(captureCharFrame())
} finally {
  // The renderer owns native timers; without destroy() the process never exits.
  renderer.destroy()
}
process.exit(0)
