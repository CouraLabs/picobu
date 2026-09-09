/**
 * Temporary smoke test: tools render collapsed with a clipped first line and
 * expand on click; message bubbles open the action dialog on click.
 * Run: bun scripts/smoke-message-actions.tsx
 */
import { testRender } from "@opentui/solid"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const longOutput = "x".repeat(300)

const messages: LoopMessage[] = [
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "run the checks" }],
  } as LoopMessage,
  {
    id: "a1",
    role: "assistant",
    parts: [
      {
        id: "t1",
        type: "tool-shell",
        state: "output-available",
        input: { command: "bun run tsc" },
        output: longOutput,
      },
      { type: "text", text: "All checks passed." },
    ],
  } as unknown as LoopMessage,
]

let opened: unknown
const setup = await testRender(
  () => (
    <SessionMessages
      messages={messages}
      onMessageOpen={(m) => {
        opened = m
      }}
    />
  ),
  { width: 60, height: 20 },
)
const { renderOnce, captureCharFrame, mockMouse, renderer } = setup
const settle = async () => {
  await renderOnce()
  await renderOnce()
}

const rowOf = (frame: string, needle: string): number =>
  frame.split("\n").findIndex((l) => l.includes(needle))

try {
  await settle()
  const collapsedFrame = captureCharFrame()
  console.log("== collapsed (default) ==")
  console.log(collapsedFrame)

  const toolRow = rowOf(collapsedFrame, "bun run tsc")
  console.log("tool row:", toolRow)
  await mockMouse.click(5, toolRow)
  await settle()
  console.log("== after click on tool line ==")
  console.log(captureCharFrame())

  // The user prompt markdown renders blank in the test renderer, so click the
  // content row just above the `Prompt` bottom border.
  const promptRow = rowOf(collapsedFrame, "Prompt")
  console.log("prompt border row:", promptRow)
  // Content rows above the border register clicks; markdown cells inside a
  // scrollbox don't fire movement handlers in the test renderer, so probe a
  // few columns until the dialog opens.
  for (const x of [0, 1, 2, 5, 20]) {
    await mockMouse.click(x, promptRow - 1)
    await settle()
    if (opened) break
  }
  console.log("dialog opened for message:", opened ? (opened as LoopMessage).id : "none")

  const assistantRow = rowOf(collapsedFrame, "All checks passed.")
  console.log("assistant row:", assistantRow)
  await mockMouse.click(5, assistantRow)
  await settle()
  console.log("dialog opened for message:", opened ? (opened as LoopMessage).id : "none")
} finally {
  renderer.destroy()
}
process.exit(0)
