import { testRender } from "@opentui/solid"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const COUNT = 40
const messages: LoopMessage[] = Array.from({ length: COUNT }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? "user" : "assistant",
  parts: [{ type: "text", text: `msg-${String(i + 1).padStart(2, "0")} line-a line-b line-c` }],
}) as unknown as LoopMessage)

const setup = await testRender(() => <SessionMessages messages={messages} />, {
  width: 60,
  height: 20,
  useConsole: false,
})
const { renderOnce, captureCharFrame, mockMouse, renderer } = setup

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 60))
    await renderOnce()
  }
}

const thumbPresent = (frame: string) => /[█▀▄]/.test(frame.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0).map((l) => l.slice(-3)).join(""))

await settle()
console.log("thumb at bottom (sticky):", thumbPresent(captureCharFrame()))

await mockMouse.scroll(30, 10, "up")
await settle()
const frameUp = captureCharFrame()
console.log("frame after scroll-up:")
console.log(frameUp)
console.log("thumb after scroll-up:", thumbPresent(frameUp))
await renderer.destroy()
