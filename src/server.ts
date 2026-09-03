#!/usr/bin/env bun
//
// Picobu in the browser. A Bun HTTP + WebSocket server that serves an xterm.js
// client and runs one picobu session per connected tab. Each session gets its
// own CliRenderer wired to WebSocket-backed stdin/stdout: renderer output is
// sent as binary ANSI frames, while keyboard bytes and resize control frames
// flow back into CliRenderer.stdin and renderer.resize().
//
// Host/port come from the `web` block in ~/.picobu/options.json (defaults
// 0.0.0.0:8080). Override ad hoc with the HOST / PORT environment variables.


import { Readable, Writable } from "node:stream";
import type { ServerWebSocket } from "bun";
import { CliRenderEvents, createCliRenderer, type CliRenderer } from "@opentui/core";
import { startPicobu } from "./app";
import { options } from "./libs/options";
import { INDEX_HTML } from "./web/index";


interface Session {
  renderer: CliRenderer | null;
  stdin: Readable | null;
  stdout: NodeJS.WriteStream | null;
  cols: number;
  rows: number;
  closed: boolean;
  pendingWrite: ((error?: Error | null) => void) | null;
}

interface ResizeControlMessage {
  type: "resize";
  cols: number;
  rows: number;
}

const DEFAULT_SIZE = { cols: 80, rows: 24 } as const;
const MAX_SIZE = { cols: 1000, rows: 500 } as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function normalizeSize(cols: unknown, rows: unknown) {
  if (typeof cols !== "number" || typeof rows !== "number") return null;
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  if (cols <= 0 || rows <= 0) return null;
  return {
    cols: Math.trunc(clamp(cols, 1, MAX_SIZE.cols)),
    rows: Math.trunc(clamp(rows, 1, MAX_SIZE.rows)),
  };
}

function readInitialSize(url: URL) {
  return (
    normalizeSize(Number(url.searchParams.get("cols")), Number(url.searchParams.get("rows"))) ??
    DEFAULT_SIZE
  );
}

function isResizeControlMessage(value: unknown): value is ResizeControlMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ResizeControlMessage).type === "resize" &&
    typeof (value as ResizeControlMessage).cols === "number" &&
    typeof (value as ResizeControlMessage).rows === "number"
  );
}

function finishPendingWrite(session: Session) {
  const pendingWrite = session.pendingWrite;
  if (!pendingWrite) return;
  session.pendingWrite = null;
  pendingWrite();
}

function setStreamSize(stdout: NodeJS.WriteStream | null, cols: number, rows: number) {
  if (!stdout) return;
  stdout.columns = cols;
  stdout.rows = rows;
}

function closeSession(ws: ServerWebSocket<Session>, code = 1000, reason = "quit") {
  if (ws.data.closed) return;
  ws.data.closed = true;
  finishPendingWrite(ws.data);

  const renderer = ws.data.renderer;
  ws.data.renderer = null;
  if (renderer) {
    try {
      renderer.destroy();
    } catch (err) {
      console.error("[picobu] error destroying renderer before WS close", err);
    }
  }

  queueMicrotask(() => {
    finishPendingWrite(ws.data);
    try {
      ws.close(code, reason);
    } catch {
      // Socket may already be closing.
    }
  });
}

/**
 * Minimal duplex stream pair for the renderer. The stdin is a plain Readable
 * whose data events are driven by the WebSocket; the stdout is a Writable that
 * forwards each chunk to the WebSocket as a binary frame.
 */
function createSessionStreams(
  ws: ServerWebSocket<Session>,
  cols: number,
  rows: number,
): { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream; rawStdin: Readable } {
  // Renderer attaches a `data` listener to stdin and expects bytes; a no-op
  // `read()` keeps the stream in flowing mode without auto-end.
  const stdin = new Readable({ read() {} });

  const stdout = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      // Copy into a fresh buffer so we don't hold a view into the feed's
      // chunk memory (reclaimed once this callback fires).
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
      if (bytes.byteLength === 0) {
        callback();
        return;
      }

      try {
        const result = ws.sendBinary(bytes);
        if (result === -1) {
          ws.data.pendingWrite = callback;
          return;
        }
        if (result === 0) {
          closeSession(ws, 1011, "socket-send-failed");
        }
      } catch {
        closeSession(ws, 1011, "socket-send-failed");
      }
      callback();
    },
  }) as NodeJS.WriteStream;
  stdout.columns = cols;
  stdout.rows = rows;

  return {
    stdin: stdin as NodeJS.ReadStream,
    stdout,
    rawStdin: stdin,
  };
}

function handleResize(ws: ServerWebSocket<Session>, cols: number, rows: number) {
  const size = normalizeSize(cols, rows);
  if (!size) return;

  ws.data.cols = size.cols;
  ws.data.rows = size.rows;
  setStreamSize(ws.data.stdout, size.cols, size.rows);
  ws.data.renderer?.resize(size.cols, size.rows);
}

async function startSession(ws: ServerWebSocket<Session>) {
  const { stdin, stdout, rawStdin } = createSessionStreams(ws, ws.data.cols, ws.data.rows);
  ws.data.stdin = rawStdin;
  ws.data.stdout = stdout;

  const renderer = await createCliRenderer({
    stdin,
    stdout,
    width: ws.data.cols,
    height: ws.data.rows,
    exitOnCtrlC: false, // we handle quit ourselves so we can tidy the socket
    exitSignals: [],
    targetFps: 60,
    useMouse: true,
  });

  ws.data.renderer = renderer;
  if (renderer.width !== ws.data.cols || renderer.height !== ws.data.rows) {
    renderer.resize(ws.data.cols, ws.data.rows);
  }

  renderer.on(CliRenderEvents.DESTROY, () => {
    if (!ws.data.closed) closeSession(ws);
  });

  startPicobu(renderer, { from: 'web', onExit: () => closeSession(ws) });
}

export function startServer(): void {
  const server = Bun.serve<Session>({
    hostname: process.env.HOST ?? options.web.host,
    port: Number(process.env.PORT ?? options.web.port),
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const initialSize = readInitialSize(url);
      const ok = srv.upgrade(req, {
        data: {
          renderer: null,
          stdin: null,
          stdout: null,
          cols: initialSize.cols,
          rows: initialSize.rows,
          closed: false,
          pendingWrite: null,
        },
      });
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    async open(ws) {
      try {
        await startSession(ws);
      } catch (err) {
        console.error("[picobu] failed to start session", err);
        ws.close(1011, "session-start-failed");
      }
    },
    drain(ws) {
      finishPendingWrite(ws.data);
    },
    message(ws, message) {
      if (ws.data.closed) return;

      // Binary frames are raw keyboard bytes from xterm.
      if (message instanceof Buffer || message instanceof Uint8Array) {
        if (!ws.data.stdin) return;
        const bytes = message instanceof Buffer ? message : Buffer.from(message);
        ws.data.stdin.push(bytes);
        return;
      }

      // JSON control frames (currently just `resize`).
      if (typeof message === "string") {
        try {
          const parsed: unknown = JSON.parse(message);
          if (isResizeControlMessage(parsed)) {
            handleResize(ws, parsed.cols, parsed.rows);
          }
        } catch {
          // Ignore malformed control frames.
        }
      }
    },
    close(ws) {
      ws.data.closed = true;
      finishPendingWrite(ws.data);

      if (ws.data.renderer) {
        try {
          ws.data.renderer.destroy();
        } catch (err) {
          console.error("[picobu] error destroying renderer on WS close", err);
        }
      }
      ws.data.renderer = null;

      try {
        ws.data.stdin?.push(null);
      } catch {
        // ignore
      }
      ws.data.stdin = null;
      ws.data.stdout = null;
    },
  },
});

const displayHost = server.hostname === "0.0.0.0" ? "localhost" : server.hostname;
console.log(`Picobu web ready on http://${displayHost}:${server.port}/`);
}