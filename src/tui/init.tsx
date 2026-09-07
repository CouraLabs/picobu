import {
  createCliRenderer,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  DebugOverlayCorner,
  CliRenderEvents,
  engine,
} from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "@tui/layout/app.tsx"
import { ClipboardProvider } from "./hooks/clipboard-provider.tsx"
import { theme } from "@states/theme-state.ts"
export type TuiAppOptions = {
  debug?: boolean
}
export async function runTui(options: TuiAppOptions = {}): Promise<void> {
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

  await render(() => (
    <ClipboardProvider clipboardService={clipboardService}>
      <App />
    </ClipboardProvider>
  ), renderer)
}
if (import.meta.main) {
  await runTui({
    debug: process.argv.includes("--debug")
  })
}
