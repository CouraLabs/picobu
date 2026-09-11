import { autoloadLlmProviders } from '@agent/model/registry.ts'
import { ensureOAuthTokens } from '@auth/index.ts'
import { CliRenderEvents, ConsolePosition, createClipboard, createCliRenderer, createHostClipboard, createRendererClipboardAdapter, DebugOverlayCorner, engine } from '@opentui/core'
import { render } from '@opentui/solid'
import { resetConsoleTitle, setConsoleTitle } from '@shared/console-title.ts'
import { theme } from '@states/theme-state.ts'
import { Splash } from '@tui/components/splash.tsx'
import { App } from '@tui/layout/app.tsx'
import { closeMessage } from '@tui/themes/logo.ts'
import { getSharedTreeSitterClient, registerParsers } from '@wrappers/treesitter-wrapper.ts'
import { createSignal, Show } from 'solid-js'
import { setClipboardService } from './hooks/clipboard.state.ts'
import { ClipboardProvider } from './hooks/clipboard-provider.tsx'
import { takeExitStatus } from './hooks/exit-status.ts'
export interface TuiAppOptions {
  debug?: boolean
  sessionId?: string
}

const HARMLESS_REJECTION = 'Controller is already closed'
const onUnhandledRejection = (reason: unknown): void => {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (message.includes(HARMLESS_REJECTION)) return
  process.off('unhandledRejection', onUnhandledRejection)
  process.nextTick(() => {
    throw reason
  })
}

export async function runTui(options: TuiAppOptions = {}): Promise<void> {
  process.on('unhandledRejection', onUnhandledRejection)
  setConsoleTitle(undefined)

  const debug = true
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    enableMouseMovement: true,
    maxFps: 30,
    useKittyKeyboard: { disambiguate: true, alternateKeys: true },
    targetFps: 30,
    gatherStats: debug,
    consoleOptions: {
      onCopySelection(text) {
        clipboardService.writeText(text, { destination: 'all-available' })
      },
      sizePercent: 50,
      position: ConsolePosition.RIGHT,
    },
    memorySnapshotInterval: debug ? 3000 : 0,
    backgroundColor: theme().background,
    onDestroy: () => {
      clipboardService.dispose()
      resetConsoleTitle()
      const exit = takeExitStatus()
      console.log(
        closeMessage(exit?.sessionId ?? 'sessionId', theme(), {
          messageCount: exit?.messageCount ?? 0,
          inputTokens: exit?.inputTokens ?? 0,
          outputTokens: exit?.outputTokens ?? 0,
          cost: exit?.cost ?? 0,
        }),
      )
      process.exit(0)
    },
  })

  await Promise.all([autoloadLlmProviders(), ensureOAuthTokens()]).catch(() => {})

  const clipboardService = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) })
  setClipboardService(clipboardService)

  if (debug) {
    renderer.configureDebugOverlay({
      enabled: true,
      corner: DebugOverlayCorner.bottomRight,
    })

    renderer.console.show()

    renderer.on(CliRenderEvents.MEMORY_SNAPSHOT, (snapshot: { heapUsed: number; heapTotal: number; arrayBuffers: number }) => {
      const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`
      console.log(`memory · heap ${mb(snapshot.heapUsed)}/${mb(snapshot.heapTotal)} · buffers ${mb(snapshot.arrayBuffers)}`)
    })
  }

  engine.attach(renderer)
  const [ready, setReady] = createSignal(false)
  await render(
    () => (
      <Show when={ready()} fallback={<Splash />}>
        <ClipboardProvider clipboardService={clipboardService}>
          <App sessionId={options.sessionId} />
        </ClipboardProvider>
      </Show>
    ),
    renderer,
  )
  await registerParsers().catch((error) => {
    console.error('picobu: parser registration failed, code blocks will render unstyled:', error)
  })
  await getSharedTreeSitterClient().catch((error) => {
    console.error('picobu: tree-sitter init failed, code blocks will render unstyled:', error)
  })
  setReady(true)
}
if (import.meta.main) {
  const flag = process.argv.indexOf('--session')
  const raw = flag >= 0 ? process.argv[flag + 1] : undefined
  await runTui({
    debug: process.argv.includes('--debug'),
    ...(flag >= 0 && raw && !raw.startsWith('-') ? { sessionId: raw } : {}),
  })
}
