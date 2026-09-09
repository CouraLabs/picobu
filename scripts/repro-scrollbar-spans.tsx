import { testRender } from "@opentui/solid"
import { theme } from "@states/theme-state.ts"
import { For } from "solid-js"

const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)

async function run(label: string, withThemeColors: boolean) {
  const { renderer, renderOnce, captureSpans } = await testRender(() => (
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
        scrollbarOptions={withThemeColors
          ? {
              trackOptions: {
                foregroundColor: theme().primary,
                backgroundColor: theme().background,
              },
            }
          : undefined}>
        <For each={lines}>{(line) => <text fg={theme().text}>{line}</text>}</For>
      </scrollbox>
    </box>
  ))
  await renderOnce()
  const frame = captureSpans()
  console.log(`=== ${label} ===`)
  for (const line of frame.lines) {
    for (const span of line.spans) {
      if (span.text.trim() === "▄" || span.text.trim() === "█" || span.text.trim() === "▀") {
        console.log(`thumb span: text=${JSON.stringify(span.text)} fg=${span.fg?.toString()} bg=${span.bg?.toString()}`)
      }
    }
  }
  await renderer.destroy()
}

await run("default", false)
await run("theme colors", true)
