import { testRender } from "@opentui/solid"
import { For } from "solid-js"

const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)

async function run(label: string, scrollbarOptions?: unknown) {
  const { renderer, renderOnce, captureCharFrame } = await testRender(() => (
    <box width={30} height={10} backgroundColor="#000000">
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        flexBasis={0}
        scrollY
        overflow="hidden"
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ justifyContent: "flex-end", gap: 1, paddingRight: 3 }}
        scrollbarOptions={scrollbarOptions as never}>
        <For each={lines}>{(line) => <text fg="#EDEDED">{line}</text>}</For>
      </scrollbox>
    </box>
  ))
  await renderOnce()
  console.log(`=== ${label} ===`)
  console.log(captureCharFrame())
  await renderer.destroy()
}

await run("default (no scrollbarOptions)", undefined)
await run("theme trackOptions", {
  trackOptions: {
    foregroundColor: "#0070F3",
    backgroundColor: "#000000",
  },
})
