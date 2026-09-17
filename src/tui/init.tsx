import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { autoloadLlmProviders } from '@agent/model/registry.ts'
import { ensureOAuthTokens } from '@auth/index.ts'
import { options as appOptions } from '@config/options.ts'
import type { TerminalCapabilities } from '@opentui/core'
import { CliRenderEvents, ConsolePosition, createClipboard, createCliRenderer, createHostClipboard, createRendererClipboardAdapter, DebugOverlayCorner, engine } from '@opentui/core'
import { render } from '@opentui/solid'
import { resetConsoleTitle, setConsoleTitle } from '@shared/console-title.ts'
import { initLogger, logError } from '@shared/logger.ts'
import { divertStderr } from '@shared/quiet-stderr.ts'
import { bumpCatalog } from '@states/catalog-state.ts'
import { theme } from '@states/theme-state.ts'
import { pushToast } from '@states/toast.state.ts'
import { Splash } from '@tui/components/splash.tsx'
import { App } from '@tui/layout/app.tsx'
import { closeMessage } from '@tui/themes/logo.ts'
import { getSharedTreeSitterClient, registerParsers } from '@wrappers/treesitter-wrapper.ts'
import { createSignal, Show } from 'solid-js'
import { setClipboardService } from './hooks/clipboard.state.ts'
import { ClipboardProvider } from './hooks/clipboard-provider.tsx'
import { takeExitStatus } from './hooks/exit-status.ts'
import { onAppReload } from './hooks/reload-bus.ts'
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from './terminal-win32.ts'
import { enableWin32InputMode } from './win32-input-mode.ts'
export interface TuiAppOptions {
  debug?: boolean
  sessionId?: string
  cwd?: string
}

export async function runTui(options: TuiAppOptions = {}): Promise<void> {
  initLogger({ runId: options.sessionId ?? `pid-${process.pid}`, systemDir: appOptions.app.systemDir })
  if (options.cwd !== undefined) {
    const next = resolve(options.cwd)
    const info = await stat(next).catch(() => undefined)
    if (!info?.isDirectory()) throw new Error(`Not a directory: ${options.cwd}`)
    process.chdir(next)
    appOptions.app.cwd = next
  }
  setConsoleTitle(undefined)
  const unguard = win32InstallCtrlCGuard()
  try {
    await startTui(options, unguard)
  } finally {
    unguard?.()
  }
}

const startTui = async (options: TuiAppOptions, unguard: (() => void) | undefined): Promise<void> => {
  const debug = options.debug ?? false
  // OpenTUI captures console.* but not raw stderr (externalOutputMode: 'passthrough'),
  // so stray writes from libraries and child processes would paint over the UI. They
  // go to the log file instead; with --debug they also land in the console overlay.
  const restoreStderr = divertStderr(debug)
  // The Ctrl+C guard on Windows turns Ctrl+C into plain stdin bytes; dropping SIGINT
  // from the renderer's exit signals keeps the app alive when a console CTRL_C_EVENT
  // still reaches us. Other platforms keep the library defaults so an external
  // `kill -INT` still shuts down through onDestroy instead of hard-killing.
  const rendererExitSignals: NodeJS.Signals[] | undefined = process.platform === 'win32' ? ['SIGTERM', 'SIGQUIT', 'SIGABRT', 'SIGHUP', 'SIGPIPE', 'SIGBREAK', 'SIGBUS'] : undefined
  // Terminals without the kitty keyboard protocol cannot report Shift with Ctrl on
  // letter chords; xterm's modifyOtherKeys mode (CSI >4;2m) makes them send
  // CSI 27;mod;code~ sequences that OpenTUI's raw parser decodes with modifiers.
  let keyboardFallbackActive = false
  // Windows ConPTY without kitty support gets win32-input-mode (DECSET 9001) so that
  // collapsed chords (ctrl+h -> 0x08, lone-ESC timing) arrive as explicit key events.
  let disableWin32InputMode: (() => void) | undefined
  const cleanupInputModes = (): void => {
    if (keyboardFallbackActive) process.stdout.write('\x1b[>4m')
    disableWin32InputMode?.()
    disableWin32InputMode = undefined
  }
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: rendererExitSignals,
    useMouse: true,
    enableMouseMovement: true,
    useKittyKeyboard: { disambiguate: true, alternateKeys: true },
    targetFps: 60,
    gatherStats: debug,
    openConsoleOnError: debug,
    externalOutputMode: 'passthrough',
    consoleOptions: {
      onCopySelection(text) {
        clipboardService.writeText(text, { destination: 'all-available' }).then(
          () => pushToast('Copied to clipboard', 'info'),
          (error) => pushToast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, 'error'),
        )
      },
      sizePercent: 50,
      position: ConsolePosition.RIGHT,
      keyBindings: [{ name: 'y', ctrl: true, action: 'copy-selection' }],
    },
    memorySnapshotInterval: debug ? 3000 : 0,
    backgroundColor: theme().background,
    onDestroy: () => {
      cleanupInputModes()
      restoreStderr()
      win32FlushInputBuffer()
      try {
        unguard?.()
      } catch {}
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

  win32DisableProcessedInput()

  const bootstrapProviders = async (): Promise<void> => {
    await Promise.all([autoloadLlmProviders(), ensureOAuthTokens()]).catch(() => {})
  }
  await bootstrapProviders()

  const clipboardService = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) })
  setClipboardService(clipboardService)

  process.on('exit', () => {
    cleanupInputModes()
  })
  renderer.on(CliRenderEvents.CAPABILITIES, (caps: TerminalCapabilities) => {
    if (caps.kitty_keyboard) return
    keyboardFallbackActive = true
    process.stdout.write('\x1b[>4;2m')
    if (disableWin32InputMode) return
    if (process.platform !== 'win32' || !process.stdin.isTTY) return
    disableWin32InputMode = enableWin32InputMode(renderer)
  })

  if (debug) {
    renderer.keyInput.on('keypress', (key) => {
      console.log(`key name=${key.name} ctrl=${key.ctrl} meta=${key.meta} shift=${key.shift} super=${key.super ?? false} source=${key.source}`)
    })
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
  onAppReload(async () => {
    setReady(false)
    try {
      await bootstrapProviders()
      bumpCatalog()
    } finally {
      setReady(true)
    }
  })
  try {
    renderer.setMaxListeners(0)
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
  } catch (error) {
    logError(error, { scope: 'tui-render' })
    throw error
  }
  await registerParsers().catch((error) => {
    logError(error, { scope: 'parser-registration' })
    console.error('picobu: parser registration failed, code blocks will render unstyled:', error)
  })
  await getSharedTreeSitterClient().catch((error) => {
    logError(error, { scope: 'tree-sitter-init' })
    console.error('picobu: tree-sitter init failed, code blocks will render unstyled:', error)
  })
  setReady(true)
}
if (import.meta.main) {
  const sessionFlag = process.argv.indexOf('--session')
  const sessionRaw = sessionFlag >= 0 ? process.argv[sessionFlag + 1] : undefined
  const cdFlag = process.argv.indexOf('--cd')
  const cdRaw = cdFlag >= 0 ? process.argv[cdFlag + 1] : undefined
  await runTui({
    debug: process.argv.includes('--debug'),
    ...(sessionFlag >= 0 && sessionRaw && !sessionRaw.startsWith('-') ? { sessionId: sessionRaw } : {}),
    ...(cdFlag >= 0 && cdRaw && !cdRaw.startsWith('-') ? { cwd: cdRaw } : {}),
  })
}
