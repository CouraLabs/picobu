/** Isolated check: does an <input> lower in the layout (margins above) get click focus? */
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { theme } from "@states/theme-state.ts"

const App = () => {
  const [value, setValue] = createSignal("")
  let input: { focus: () => void } | null = null
  return (
    <box flexDirection="column">
      <text>tabs row</text>
      <box marginTop={1} flexDirection="column">
        <text>option a</text>
        <text>option b</text>
        <box marginTop={1}>
          <input
            ref={(r: never) => (input = r)}
            placeholder="Type here"
            placeholderColor={theme().textMuted}
            textColor={theme().text}
            width={30}
            onInput={(v: string) => setValue(v)}
          />
        </box>
      </box>
      <text>VALUE: {value() || "(empty)"}</text>
    </box>
  )
}

const { renderOnce, captureCharFrame, mockMouse, mockInput, renderer } = await testRender(() => <App />, {
  width: 50,
  height: 10,
})

try {
  await renderOnce()
  console.log("--- before click ---")
  console.log(captureCharFrame())
  await mockMouse.click(5, 5)
  mockInput.typeText("hello")
  await renderOnce()
  console.log("--- after click + type ---")
  console.log(captureCharFrame())
} finally {
  renderer.destroy()
}
process.exit(0)
