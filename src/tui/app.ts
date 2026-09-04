import {
  BoxRenderable,
  TextRenderable,
  createCliRenderer,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  type ClipboardService,
  type HostClipboardService,
  type KeyEvent,
} from "@opentui/core"
import { DEFAULT_THEMES, resolveTheme } from "@tui/themes/index.ts"

const DEFAULT_THEME_NAME = "tacos"

export type TuiAppOptions = {
  /** Theme name from `@tui/themes` (defaults to the house theme). */
  theme?: string
}

/**
 * Boots the picobu terminal app on @opentui/core.
 *
 * Lifecycle: the code that creates the renderer owns its release — `destroy()`
 * runs on every shutdown path (quit key, Ctrl+C/signals via `exitOnCtrlC`,
 * and setup failures through `finally`). Rendering is demand-driven: key
 * handlers mutate renderable properties and OpenTUI schedules one-shot frames.
 */
export async function runTui(options: TuiAppOptions = {}): Promise<void> {
  const themeName = options.theme ?? DEFAULT_THEME_NAME
  const themeJson = DEFAULT_THEMES[themeName] ?? Object.values(DEFAULT_THEMES)[0]!
  const theme = resolveTheme(themeJson, "dark")

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: theme.background,
  })

  // Clipboard ownership: createClipboard() adopts the host service, so track
  // partial initialization explicitly and dispose the last acquired owner.
  let host: HostClipboardService | undefined
  let clipboard: ClipboardService | undefined

  try {
    host = createHostClipboard()
    clipboard = createClipboard({
      host,
      terminal: createRendererClipboardAdapter(renderer),
    })
    host = undefined // createClipboard() now owns the host service

    let count = 0

    // Header: full-width bordered strip, no margins (terminal-density rule).
    const header = new BoxRenderable(renderer, {
      width: "100%",
      height: 3,
      border: true,
      borderColor: theme.border,
      paddingX: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    })
    header.add(
      new TextRenderable(renderer, { content: "PICOBU", fg: theme.primary }),
    )
    header.add(
      new TextRenderable(renderer, {
        content: "headless core · tui",
        fg: theme.textMuted,
      }),
    )

    // Main content grows to fill all remaining rows.
    const main = new BoxRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      paddingX: 1,
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      gap: 1,
    })
    const counter = new TextRenderable(renderer, {
      content: "Count 0",
      fg: theme.text,
    })
    const status = new TextRenderable(renderer, {
      content: "",
      fg: theme.textMuted,
    })
    main.add(counter)
    main.add(
      new TextRenderable(renderer, {
        content: "the agent loop is one step away",
        fg: theme.textMuted,
      }),
    )
    main.add(status)

    // Footer: single-row status line pinned to the bottom.
    const footer = new BoxRenderable(renderer, {
      width: "100%",
      height: 1,
      backgroundColor: theme.backgroundPanel,
      paddingX: 1,
      flexDirection: "row",
      justifyContent: "space-between",
    })
    footer.add(
      new TextRenderable(renderer, {
        content: "←/→ count · r reset · c copy · v paste · n notify",
        fg: theme.textMuted,
      }),
    )
    footer.add(
      new TextRenderable(renderer, { content: "q quit", fg: theme.textMuted }),
    )

    renderer.root.add(header)
    renderer.root.add(main)
    renderer.root.add(footer)

    const setStatus = (text: string, ok = true): void => {
      status.content = text
      status.fg = ok ? theme.success : theme.error
    }

    // Best-effort async side effects: report the outcome in the status line,
    // never let a rejection escape into the key handler.
    const copyCount = (): void => {
      clipboard
        ?.writeText(`Count ${count}`, { destination: "best-available" })
        .then((result) => {
          const ok =
            result.host.status === "written" ||
            result.terminal.status === "attempted"
          setStatus(
            ok ? `copied "Count ${count}"` : "copy not available",
            ok,
          )
        })
        .catch(() => setStatus("copy failed", false))
    }

    const pasteCount = (): void => {
      clipboard
        ?.read({ preferredTypes: ["text/plain"] })
        .then((result) => {
          if (result.status !== "read") {
            setStatus(`paste: ${result.status}`, false)
            return
          }
          const text = new TextDecoder().decode(result.representation.bytes)
          count = Number.parseInt(text, 10)
          if (!Number.isNaN(count)) {
            counter.content = `Count ${count}`
            setStatus(`pasted ${text}`)
          } else {
            setStatus(`clipboard: ${text}`, false)
          }
        })
        .catch(() => setStatus("paste failed", false))
    }

    const notify = (): void => {
      const ok = renderer.triggerNotification(
        `Count is ${count}`,
        "PICOBU",
      )
      setStatus(ok ? "notification sent" : "notifications unsupported", ok)
    }

    // App-wide keys. Direct listeners run before any focused renderable;
    // remove them when their owner (the renderer) stops.
    const onKeyPress = (key: KeyEvent): void => {
      if (key.name === "q" || key.name === "escape") {
        renderer.destroy()
        return
      }

      if (key.name === "left") count--
      else if (key.name === "right") count++
      else if (key.name === "r") count = 0
      else if (key.name === "c") return copyCount()
      else if (key.name === "v") return pasteCount()
      else if (key.name === "n") return notify()
      else return

      counter.content = `Count ${count}`
    }
    renderer.keyInput.on("keypress", onKeyPress)
    renderer.once("destroy", () => {
      renderer.keyInput.off("keypress", onKeyPress)
    })

    // Stay alive until any shutdown path destroys the renderer.
    await new Promise<void>((resolve) => renderer.once("destroy", resolve))
  } finally {
    try {
      // Asynchronous: aborts active ops, then releases native workers.
      // A clipboard cleanup failure must not skip terminal restoration.
      if (clipboard) await clipboard.dispose()
      else if (host) await host.dispose()
    } finally {
      // Synchronous and idempotent; restores the terminal state.
      renderer.destroy()
    }
  }
}

if (import.meta.main) {
  await runTui()
}
