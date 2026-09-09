import { createTestRenderer } from "@opentui/core/testing"
import { ScrollBoxRenderable, BoxRenderable, TextRenderable, RGBA } from "@opentui/core"

const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)

async function run(label, scrollbarOptions) {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width: 30,
    height: 10,
    useConsole: false,
  })
  const root = new BoxRenderable(renderer, { width: 30, height: 10, backgroundColor: RGBA.fromHex("#000000") })
  const scrollbox = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    scrollY: true,
    overflow: "hidden",
    scrollbarOptions,
    contentOptions: { justifyContent: "flex-end", gap: 1, paddingRight: 3 },
  })
  for (const line of lines) {
    scrollbox.add(new TextRenderable(renderer, { content: line, fg: "#EDEDED" }))
  }
  root.add(scrollbox)
  renderer.root.add(root)
  await renderOnce()
  const frame = captureCharFrame()
  console.log(`=== ${label} ===`)
  console.log(frame)
  await renderer.destroy()
}

await run("default (no scrollbarOptions)", undefined)
await run("theme trackOptions", {
  trackOptions: {
    foregroundColor: RGBA.fromHex("#0070F3"),
    backgroundColor: RGBA.fromHex("#000000"),
  },
})
