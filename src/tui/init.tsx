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
import { getSharedTreeSitterClient, registerParsers } from "@wrappers/treesitter-wrapper.ts"
import { ClipboardProvider } from "./hooks/clipboard-provider.tsx"
import { setClipboardService } from "./hooks/clipboard.state.ts"
import { Splash } from "@tui/components/splash.tsx"
import { theme } from "@states/theme-state.ts"
export type TuiAppOptions = {
  debug?: boolean
}

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
  const [ready, setReady] = createSignal(false)
  await render(() => (
    <Show when={ready()} fallback={<Splash />}>
      <ClipboardProvider clipboardService={clipboardService}>
        <App />
      </ClipboardProvider>
    </Show>
  ), renderer)
  await registerParsers().catch((error) => {
    console.error("picobu: parser registration failed, code blocks will render unstyled:", error)
  })
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
