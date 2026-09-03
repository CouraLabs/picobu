import { useEffect, useState } from "react";
import type { CliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions, useKeyboard } from "@opentui/react";
import { registerSpinner } from "opentui-spinner/react";
import { registerQRCode } from "@opentui/qrcode/react";
import { useTheme } from "./hooks/useTheme";
import { SessionPage } from "./pages/SessionPage";
import { ThreeDPage } from "./pages/ThreeDPage";
import { WhatsAppPage } from "./pages/WhatsAppPage";
import { PomodoroPage } from "./pages/PomodoroPage";
import { CronsPage } from "./pages/CronsPage";
import { HelpDialog } from "./components/dialogs/HelpDialog";
import { Header } from "./components/layout/Header";
import type { CodingTabId, PageId } from "./components/layout/Tabs";
import { CodingSessionProvider } from "./providers/SessionProvider";
import { PersistentSessionProvider } from "./providers/PersistentSessionProvider";
import { SessionBindingsProvider, useSessionBindings } from "./providers/SessionBindings";
import { createSessionBindings } from "./harness/commands/bindings";
import { startCronScheduler } from "./cron/cron-store";
import { connectToWhatsApp } from "./integrations/whatsapp/connection";
import { options } from "./libs/options";
import { generateSessionId } from "./libs/sessions";
import { DialogProvider } from "./providers/DialogProvider";
import { useDialog } from "./hooks/useDialog";

registerSpinner();
registerQRCode();

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

  // Bootstrap long-lived background services once per app mount: the cron
  // scheduler (30s sweep) and, when enabled in options, the WhatsApp
  // connection (reconnects from persisted credentials without a QR).
  useEffect(() => {
    startCronScheduler();
    if (options.whatsapp.enabled) void connectToWhatsApp();
  }, []);

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
    <CodingSessionProvider key={sessionId}>
      <PersistentSessionProvider>
        <box id="app" width={dims.width} height={dims.height} paddingX={2} paddingBottom={1} flexDirection="column" backgroundColor={theme.background}>
          <Header page={page} onPageChange={setPage} />
          <box id="router-outlet" flexDirection="row" flexGrow={1}>
            {page === "SESSIONS" && <SessionPage sessionTab={codingTab} onCodingTabChange={setCodingTab} />}
            {page === "WHATSAPP" && <WhatsAppPage />}
            {page === "POMODORO" && <PomodoroPage />}
            {page === "CRONS" && <CronsPage />}
            {page === "3D" && <ThreeDPage />}
          </box>
        </box>
      </PersistentSessionProvider>
    </CodingSessionProvider>
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
  renderer.setTerminalTitle("Picobu");

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
