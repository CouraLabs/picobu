/**
 * The browser client as a TypeScript module so the page and its node_modules
 * assets (xterm.css, xterm.js, addon-fit.js) are bundled with future builds
 * instead of being read from disk and served from the node_modules tree.
 */
import xtermCss from "@xterm/xterm/css/xterm.css" with { type: "text" };
import xtermJs from "@xterm/xterm/lib/xterm.js" with { type: "text" };
import fitAddonJs from "@xterm/addon-fit/lib/addon-fit.js" with { type: "text" };

/** Escape an inline script body so a `</script>` inside the asset cannot close the tag early. */
const inlineScript = (source: string): string => source.replace(/<\/script/gi, "<\\/script");

const CLIENT_SCRIPT = `
      const terminalHost = document.getElementById("picobu");

      const term = new Terminal({
        cursorBlink: false,
        fontFamily: '"JetBrains Mono", monospace',
        fontStyle: 'normal',
        fontSize: 14,
        lineHeight: 1,
        scrollback: 100000,
        theme: { background: "#000000" },
      });

      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalHost);

      let ws = null;
      let lastSentCols = 0;
      let lastSentRows = 0;

      function sendSize() {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (term.cols <= 0 || term.rows <= 0) return;
        if (term.cols === lastSentCols && term.rows === lastSentRows) return;
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        lastSentCols = term.cols;
        lastSentRows = term.rows;
      }

      function connect() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        // Forward the page's query params (e.g. an auth token behind a proxy).
        const url = new URL("/ws", protocol + "//" + location.host);
        for (const [key, value] of new URLSearchParams(location.search)) {
          url.searchParams.set(key, value);
        }
        if (term.cols > 0 && term.rows > 0) {
          url.searchParams.set("cols", String(term.cols));
          url.searchParams.set("rows", String(term.rows));
        }

        ws = new WebSocket(url.href);
        ws.binaryType = "arraybuffer";

        ws.addEventListener("open", () => {
          fitAddon.fit();
          sendSize();
          term.focus();
        });
        ws.addEventListener("message", (ev) => {
          // Binary frames are rendered ANSI output from the server.
          if (ev.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(ev.data));
          }
        });
        ws.addEventListener("close", () => {});
        ws.addEventListener("error", () => {});
      }

      term.onResize(() => {
        lastSentCols = 0;
        lastSentRows = 0;
        sendSize();
      });

      // Keyboard -> server. xterm gives raw bytes, pass them through verbatim.
      term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data));
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        sendSize();
      });
      resizeObserver.observe(terminalHost);

      window.addEventListener("focus", () => term.focus());
      terminalHost.addEventListener("pointerdown", () => term.focus());

      term.focus();
      fitAddon.fit();
      connect();
`;

export const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PICOBU</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap" rel="stylesheet">
    <style>
${xtermCss}
    </style>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }

      #picobu {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <div id="picobu"></div>

    <script>
${inlineScript(xtermJs)}
    </script>
    <script>
${inlineScript(fitAddonJs)}
    </script>
    <script>
${CLIENT_SCRIPT}
    </script>
  </body>
</html>`;
