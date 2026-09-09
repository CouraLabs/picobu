/**
 * Smoke test: the model select dialog lists providers/models with context and
 * rates, filters as you type, and selects with enter (or click).
 * Run: bun scripts/smoke-model-select.tsx
 */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { ModelSelect } from "@tui/components/session/model-select.tsx"

const App = () => {
  const [selected, setSelected] = createSignal("")
  return (
    <box flexDirection="column">
      <ModelSelect currentModelKey={undefined} onSelect={(key) => setSelected(key)} />
      <text>SELECTED: {selected() || "(none)"}</text>
    </box>
  )
}

const { renderOnce, captureCharFrame, mockInput, renderer } = await testRender(() => <App />, {
  width: 90,
  height: 24,
})

const frameOf = async (label: string) => {
  await renderOnce()
  const frame = captureCharFrame()
  console.log(`--- ${label} ---`)
  console.log(frame)
  return frame
}

try {
  await frameOf("open (autofocused search)")

  await mockInput.typeText("deep")
  const filtered = await frameOf("filtered by 'deep'")

  await mockInput.pressArrow("down")
  await frameOf("highlight moved down")

  await mockInput.pressEnter()
  await renderOnce()
  const done = captureCharFrame()
  console.log("--- after enter ---")
  console.log(done)
  const selectedLine = done.split("\n").find((line) => line.includes("SELECTED:")) ?? ""
  console.log(selectedLine.includes("(none)") ? "FAIL: nothing selected" : `PASS: ${selectedLine.trim()}`)
} finally {
  renderer.destroy()
}
process.exit(0)
