/**
 * Repro: reasoning header stays "Reasoning..." after streaming because the AI SDK
 * mutates the part object in place (state: "streaming" -> "done") and Solid's
 * memo chain never sees the change. Mimics Chat.write() -> replaceMessage()
 * with the same object reference, then setMessages([...state.messages]).
 * Run: bun scripts/smoke-reasoning-stuck.tsx
 */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const reasoningPart: any = {
  type: "reasoning",
  id: "r1",
  text: "Thinking about pointers.",
  state: "streaming",
}

const [messages, setMessages] = createSignal<LoopMessage[]>([
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "why is it called a pointer?" }],
  } as LoopMessage,
  {
    id: "a1",
    role: "assistant",
    parts: [reasoningPart],
  } as unknown as LoopMessage,
])

const testSetup = await testRender(
  () => <SessionMessages messages={messages()} />,
  { width: 60, height: 20 },
)
const { renderOnce, captureCharFrame, renderer, waitForFrame } = testSetup

try {
  await waitForFrame((frame) => frame.includes("Reasoning"))
  console.log("streaming frame shows: Reasoning (expected)")

  // Simulate reasoning-end: SDK mutates the part in place and re-notifies
  // with the same object references.
  reasoningPart.state = "done"
  setMessages([...messages()])
  await renderOnce()
  await Bun.sleep(300)

  const frame = captureCharFrame()
  const stillReasoning = frame.includes("Reasoning")
  const showsThought = frame.includes("Thought")
  console.log("after in-place state flip:")
  console.log(frame)
  console.log(`stuck on "Reasoning...": ${stillReasoning}, shows "Thought": ${showsThought}`)
  process.exit(stillReasoning || !showsThought ? 1 : 0)
} finally {
  renderer.destroy()
}
