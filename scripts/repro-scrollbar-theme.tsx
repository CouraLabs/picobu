import { testRender } from "@opentui/solid"
import { theme } from "@states/theme-state.ts"
import { For } from "solid-js"

const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)

const { renderer, renderOnce, captureCharFrame } = await testRender(() => (
  <box width={30} height={10} backgroundColor={theme().background}>
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      scrollY
      overflow="hidden"
      stickyScroll
      stickyStart="bottom"
      contentOptions={{ justifyContent: "flex-end", gap: 1, paddingRight: 3 }}
      scrollbarOptions={{
        trackOptions: {
          foregroundColor: theme().primary,
          backgroundColor: theme().background,
        },
      }}>
      <For each={lines}>{(line) => <text fg={theme().text}>{line}</text>}</For>
    </scrollbox>
  </box>
))
await renderOnce()
console.log(`theme: primary=${theme().primary.toString()} background=${theme().background.toString()}`)
console.log(captureCharFrame())
await renderer.destroy()
