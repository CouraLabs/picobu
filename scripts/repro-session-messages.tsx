import { testRender } from "@opentui/solid"
import { SessionMessages } from "@tui/components/session/session-messages.tsx"
import { setTheme } from "@states/theme-state.ts"
import type { LoopMessage } from "@agent/loop/create-loop.ts"

const messages: LoopMessage[] = Array.from({ length: 30 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 === 0 ? "user" : "assistant",
  parts: [{ type: "text", text: `message line ${i} — some longer content to fill width` }],
})) as unknown as LoopMessage[]

const setup = await testRender(() => <SessionMessages messages={messages} />, {
  width: 80,
  height: 20,
  useConsole: false,
})
await setup.renderOnce()
console.log("--- initial (synthwave84 dark) ---")
console.log(setup.captureCharFrame())

setTheme("tacos", "dark")
await setup.waitFor(() => true)
await setup.renderOnce()
console.log("--- after setTheme(tacos, dark) ---")
console.log(setup.captureCharFrame())
await setup.renderer.destroy()
