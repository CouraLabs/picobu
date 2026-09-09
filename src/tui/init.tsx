import {
  createCliRenderer,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  DebugOverlayCorner,
  CliRenderEvents,
  engine,
} from "@opentui/core"
import { createSignal, Show } from "solid-js"
import { render } from "@opentui/solid"
import { App } from "@tui/layout/app.tsx"
// Registers the local parser WASMs (see `src/wrappers/parsers/`) as global
// overrides and creates the shared Tree-sitter client. Must complete before
// the first markdown/code render (no internal fallback) — the splash covers
// the load time so startup doesn't show a frozen frame.
import { getSharedTreeSitterClient, registerParsers } from "@wrappers/treesitter-wrapper.ts"
import { ClipboardProvider } from "./hooks/clipboard-provider.tsx"
import { setClipboardService } from "./hooks/clipboard.state.ts"
import { Splash } from "@tui/components/splash.tsx"
import { theme } from "@states/theme-state.ts"
export type TuiAppOptions = {
  debug?: boolean
}

// `ai`'s readUIMessageStream closes its controller in a `.finally()` and can
// race with stream teardown (run stopped, session closed) — the resulting
// "Controller is already closed" rejection is harmless and unactionable.
// Everything else is a real bug: restore the default (fatal) behavior by
// removing this filter and re-raising, so unexpected rejections still print
// a stack and exit non-zero instead of being silently logged.
const HARMLESS_REJECTION = "Controller is already closed"
const onUnhandledRejection = (reason: unknown): void => {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (message.includes(HARMLESS_REJECTION)) return
  process.off("unhandledRejection", onUnhandledRejection)
  process.nextTick(() => {
    throw reason
  })
}

export async function runTui(options: TuiAppOptions = {}): Promise<void> {
  process.on("unhandledRejection", onUnhandledRejection)

  const debug = options.debug === true
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    enableMouseMovement: true,
    useKittyKeyboard: { disambiguate: true, alternateKeys: true },
    targetFps: 30,
    gatherStats: debug,
    memorySnapshotInterval: debug ? 3000 : 0,
    backgroundColor: theme().background,
    onDestroy: () => {
      clipboardService.dispose()
      process.exit(0)
    }
  })
  
  const clipboardService = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer)})
  setClipboardService(clipboardService)

  if (debug) {
    renderer.configureDebugOverlay({
      enabled: true,
      corner: DebugOverlayCorner.bottomRight,
    })
    
    renderer.console.show()

    renderer.on(
      CliRenderEvents.MEMORY_SNAPSHOT,
      (snapshot: { heapUsed: number; heapTotal: number; arrayBuffers: number }) => {
        const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`
        console.log(`memory · heap ${mb(snapshot.heapUsed)}/${mb(snapshot.heapTotal)} · buffers ${mb(snapshot.arrayBuffers)}`)
      },
    )
  }

  engine.attach(renderer)

  // Splash first, parsers second: parser loading blocks the first meaningful
  // render, so show the logo immediately and swap in the app when ready.
  const [ready, setReady] = createSignal(false)
  await render(() => (
    <Show when={ready()} fallback={<Splash />}>
      <ClipboardProvider clipboardService={clipboardService}>
        <App />
      </ClipboardProvider>
    </Show>
  ), renderer)

  await registerParsers()
  // A failed worker init only costs syntax highlighting (blocks render
  // unstyled), so swallow it rather than taking down the TUI.
  await getSharedTreeSitterClient().catch((error) => {
    console.error("picobu: tree-sitter init failed, code blocks will render unstyled:", error)
  })
  setReady(true)
}
if (import.meta.main) {
  await runTui({
    debug: process.argv.includes("--debug")
  })
}
