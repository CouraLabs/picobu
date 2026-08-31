import { ConsolePosition, createCliRenderer } from "@opentui/core";
import { startPicobu } from "./app";
import { logo } from "./components/symbols/logo";
import { generateSessionId } from "./libs/sessions";

/**
 * TUI entry point. Renders the OpenTUI app into the terminal; `/quit`
 * (`/q`, `/exit`) routes through the session's onExit hook -> destroy() tears
 * the renderer down, firing `onDestroy` (resume banner + process.exit()). The
 * same onDestroy fires on ctrl-C (exitOnCtrlC), so both paths exit gracefully.
 */
export async function startTui(opts: { sessionId?: string } = {}): Promise<void> {
  const sessionId = opts.sessionId ?? generateSessionId();

  const opentui = await createCliRenderer({
    maxFps: 60,
    useMouse: true,
    exitOnCtrlC: true,
    consoleOptions: {
      position: ConsolePosition.RIGHT
    },
    onDestroy() {
      console.log("")
      console.log(logo())
      console.log("")
      console.log("\x1b[1m\x1b[32mTo resume this sesion:\x1b[0m")
      console.log(`\x1b[38;5;241;48m$ \x1b[0mpicobu \x1b[38;5;241;48m--session\x1b[0m ${sessionId}\x1b[0m`)
      process.exit()
    },
  });

  startPicobu(opentui, { sessionId, from: 'terminal' });
}
