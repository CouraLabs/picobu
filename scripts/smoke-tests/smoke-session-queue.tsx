/**
 * Smoke test: clicking [ Remove ] on a queued prompt fires onRemove with that
 * row's id and the item leaves the list. Run: bun scripts/smoke-tests/smoke-session-queue.tsx
 */
import type { QueuedPrompt } from "@agent/sessions/session.ts"
import { testRender } from "@opentui/solid"
import { SessionQueue } from "@tui/components/session/session-queue.tsx"
import { createSignal } from "solid-js"

const item = (id: string, text: string): QueuedPrompt => ({ id, text, queuedAt: Date.now(), steered: false, files: [] })

const [items, setItems] = createSignal<Array<QueuedPrompt>>([item("q1", "first queued prompt"), item("q2", "second queued prompt")])
const removed: Array<string> = []

const setup = await testRender(
  () => (
    <SessionQueue
      items={items()}
      onRemove={(id) => {
        removed.push(id)
        setItems((prev) => prev.filter((entry) => entry.id !== id))
      }}
    />
  ),
  { width: 80, height: 12 },
)
const { renderOnce, captureCharFrame, mockMouse, renderer } = setup

let failed = false
const expectTrue = (label: string, condition: boolean) => {
  if (condition) console.log(`PASS: ${label}`)
  else {
    failed = true
    console.log(`FAIL: ${label}`)
  }
}

try {
  await renderOnce()
  await renderOnce()
  const frame = captureCharFrame()
  console.log(frame)
  const lines = frame.split("\n")
  const row = lines.findIndex((l) => l.includes("first queued prompt"))
  const col = (lines[row] ?? "").indexOf("Remove")

  expectTrue("first row renders its Remove button", row >= 0 && col >= 0)

  await mockMouse.click(col + 1, row)
  await renderOnce()
  await renderOnce()
  const after = captureCharFrame()

  expectTrue("onRemove fires with the clicked row's id", removed.length === 1 && removed[0] === "q1")
  expectTrue("removed item leaves the list", !after.includes("first queued prompt"))
  expectTrue("the other item stays", after.includes("second queued prompt"))
} finally {
  renderer.destroy()
}
process.exit(failed ? 1 : 0)
