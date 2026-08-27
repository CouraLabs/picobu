import { createCliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions } from "@opentui/react";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "./stores/theme-store";
import { useState } from "react";
import { registerSpinner } from "opentui-spinner/react";
import { CodingPage } from "./pages/CodingPage";
import { SplashPage } from "./pages/SplashPage";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { logo } from "./components/symbols/logo";
import { CodingSessionProvider } from "./components/coding/session";
import { bindExit } from "./harness/commands";

registerSpinner();

const opentui = await createCliRenderer({
  maxFps: 30,
  useMouse: true,
  exitOnCtrlC: true,
  onDestroy() {
    console.log("")
    console.log(logo())
    console.log("")
    console.log("\x1b[1m\x1b[32mTo resume this sesion:\x1b[0m")
    console.log("\x1b[38;5;241;48m$ \x1b[0mpicobu \x1b[38;5;241;48m--session\x1b[0m <session_id>")
    process.exit()
  },
});

opentui.setTerminalTitle("PICOBU");

// `/quit` (/q, /exit) routes through the onExit hook: destroy() tears the
// renderer down, firing `onDestroy` (resume banner + process.exit()). The
// same onDestroy fires on ctrl-C (exitOnCtrlC), so both paths exit gracefully.
bindExit(() => opentui.destroy());

const App = () => {
  const dims = useTerminalDimensions();
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const [page, setPage] = useState("coding");

  return (
    <box id="app" width={dims.width} height={dims.height} flexDirection="column" backgroundColor={theme.background}>
      <Header page={page} onPageChange={setPage} />
      <CodingSessionProvider>
        <box id="router-outlet" flexDirection="row" flexGrow={1}>
          {page === "coding" && <CodingPage />}
          {page === "main" && <SplashPage />}
        </box>
      </CodingSessionProvider>
      <Footer />
    </box>
  );
}

createRoot(opentui).render(<App />);