/**
 * Smoke test: a global useKeyboard handler sees Tab/Shift+Tab/Ctrl+M even when
 * the prompt textarea is focused, and preventDefault stops the textarea from
 * receiving them. Run: bun scripts/smoke-keybinds.tsx
 */
import { testRender } from "@opentui/solid"
import { useKeyboard } from "@opentui/solid"
import { onMount } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { createSignal } from "solid-js"

const App = () => {
  const [seen, setSeen] = createSignal("")
  const [text, setText] = createSignal("")
  let textareaRef: TextareaRenderable | null = null

  onMount(() => textareaRef?.focus())

  useKeyboard((key) => {
    if (key.name === "tab") {
      key.preventDefault()
      key.stopPropagation()
      setSeen(key.shift ? "shift-tab" : "tab")
      return
    }
    if (key.ctrl && key.name === "m") {
      key.preventDefault()
      key.stopPropagation()
      setSeen("ctrl-m")
    }
  })

  return (
    <box flexDirection="column">
      <text>SEEN: {seen() || "(nothing)"}</text>
      <textarea
        ref={(r) => textareaRef = r}
        id="prompt"
        height={3}
        onInput={(v: string) => setText(v)}
      />
      <text>TEXT: "{text()}"</text>
    </box>
  )
}

const { renderOnce, captureCharFrame, mockInput, renderer } = await testRender(() => <App />, {
  width: 40,
  height: 8,
  kittyKeyboard: true,
})

const frameOf = async (label: string) => {
  await renderOnce()
  console.log(`--- ${label} ---`)
  console.log(captureCharFrame())
}

try {
  await mockInput.typeText("hi")
  await frameOf("typed 'hi' into focused textarea")

  await mockInput.pressTab()
  await frameOf("after tab")

  await mockInput.pressTab({ shift: true })
  await frameOf("after shift+tab")

  await mockInput.pressKey("m", { ctrl: true })
  await frameOf("after ctrl+m")
} finally {
  renderer.destroy()
}
process.exit(0)
