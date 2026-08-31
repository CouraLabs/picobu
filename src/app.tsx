import { useEffect, useState } from "react";
import type { CliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions, useKeyboard } from "@opentui/react";
import { registerSpinner } from "opentui-spinner/react";
import { useTheme } from "./hooks/useTheme";
import { SessionPage } from "./pages/SessionPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ThreeDPage } from "./pages/ThreeDPage";
import { HelpDialog } from "./components/HelpDialog";
import { Header } from "./components/Header";
import type { CodingTabId, PageId } from "./components/Tabs";
import { CodingSessionProvider } from "./providers/SessionProvider";
import { PersistentSessionProvider } from "./providers/PersistentSessionProvider";
import { SessionBindingsProvider, useSessionBindings } from "./providers/SessionBindings";
import { createSessionBindings } from "./harness/commands/bindings";
import { generateSessionId } from "./libs/sessions";
import { DialogProvider } from "./providers/DialogProvider";
import { useDialog } from "./hooks/useDialog";

registerSpinner();

export function App() {
  const dialog = useDialog();
  const bindings = useSessionBindings();
  const dims = useTerminalDimensions();
  const { theme } = useTheme();
  const [page, setPage] = useState<PageId>("SESSIONS");
  // App stays mounted across page switches, so the inner coding tab survives navigation.
  const [codingTab, setCodingTab] = useState<CodingTabId>("coding");
  // Mirrors bindings.sessionId: /new and /sessions swap it, remounting the
  // coding session provider (fresh loop + fresh saver keyed by session id).
  const [sessionId, setSessionId] = useState(bindings.sessionId);
  useEffect(() => bindings.bindSessionChange(setSessionId), [bindings]);

  // `ctrl+?` opens the help dialog from anywhere. A lone `?` typed as the
  // prompt's first character also opens it (handled in the Prompt component).
  useKeyboard((key) => {
    if (key.name === "?" && key.ctrl) {
      key.preventDefault();
      key.stopPropagation();
      dialog.replace(<HelpDialog />, "medium", "Keyboard Shortcuts");
      dialog.open();
    }
  });

  return (
    <box id="app" width={dims.width} height={dims.height} paddingX={2} paddingBottom={1} flexDirection="column" backgroundColor={theme.background}>
      <Header page={page} onPageChange={setPage} />
      <box id="router-outlet" flexDirection="row" flexGrow={1}>
        {page === "SESSIONS" && (
          <CodingSessionProvider key={sessionId}>
            <PersistentSessionProvider>
              <SessionPage sessionTab={codingTab} onCodingTabChange={setCodingTab} />
            </PersistentSessionProvider>
          </CodingSessionProvider>
        )}
        {page === "CONFIG" && <SettingsPage />}
        {page === "3D" && <ThreeDPage />}
      </box>
    </box>
  );
}

export type StartPicobuOptions = {
  /** Invoked when `/quit` fires; defaults to destroying the renderer. */
  onExit?: () => void;
  /** Resume an existing session; a fresh id is generated when omitted. */
  sessionId?: string;
  from: 'web' | 'terminal'
};

/**
 * Wire one renderer into the picobu app. Call once per renderer — the CLI
 * renderer in `index.tsx`, and one renderer per web socket session in
 * `server.ts`. Each call gets its own `SessionBindings` so exit/accept are
 * isolated between sessions, while the shared stores (theme/model/agent) stay
 * global.
 */
export function startPicobu(renderer: CliRenderer, options: StartPicobuOptions = { from: 'terminal' }): void {
  renderer.setTerminalTitle("PICOBU");

  const bindings = createSessionBindings({
    sessionId: options.sessionId ?? generateSessionId(),
    frontend: options.from,
  });
  bindings.bindExit(() => {
    if (options.onExit) options.onExit();
    else renderer.destroy();
  });

  createRoot(renderer).render(
    <SessionBindingsProvider bindings={bindings}>
      <DialogProvider>
        <App />
      </DialogProvider>
    </SessionBindingsProvider>,
  );
}
