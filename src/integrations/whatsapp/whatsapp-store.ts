export type WhatsAppStatus = "disconnected" | "connecting" | "awaiting-qr" | "connected" | "error";

export type WhatsAppLogEntry = { at: number; message: string };

export type WhatsAppState = {
  status: WhatsAppStatus;
  /** Pending Baileys QR string (only while `awaiting-qr`). */
  qr: string | null;
  /** Active numeric pairing code (alternative to the QR). */
  pairingCode: string | null;
  /** Own JID once connected. */
  jid: string | null;
  error: string | null;
  /** Recent activity, newest last. */
  log: WhatsAppLogEntry[];
};

const MAX_LOG = 100;

export type WhatsAppStoreState = WhatsAppState;

/**
 * Minimal external store (the removed `@xstate/store` dependency had exactly
 * one consumer surface): snapshot reads via `getSnapshot().context` and event
 * triggers via `trigger.<event>(payload)`. Not reactive — hosts poll or wire
 * their own subscription if they need one.
 */
const createStore = (initial: WhatsAppState) => {
  let context = initial;

  const define = <P,>(event: (s: WhatsAppState, e: P) => WhatsAppState) => {
    return (payload: P) => {
      context = event(context, payload);
    };
  };

  const store = {
    getSnapshot: () => ({ context }),
    trigger: {
      setStatus: define((s, e: { status: WhatsAppStatus }) => ({ ...s, status: e.status })),
      setQr: define((s, e: { qr: string | null }) => ({
        ...s,
        qr: e.qr,
        status: e.qr ? ("awaiting-qr" as const) : s.status,
      })),
      setPairingCode: define((s, e: { code: string | null }) => ({ ...s, pairingCode: e.code })),
      setConnected: define((s, e: { jid: string | null }) => ({
        ...s,
        status: "connected" as const,
        qr: null,
        pairingCode: null,
        jid: e.jid,
        error: null,
      })),
      setError: define((s, e: { error: string }) => ({ ...s, status: "error" as const, error: e.error })),
      /** Append an activity line (capped at `MAX_LOG`). */
      log: define((s, e: { message: string }) => ({
        ...s,
        log: [...s.log, { at: Date.now(), message: e.message }].slice(-MAX_LOG),
      })),
    },
  };

  return store;
};

/** Live WhatsApp connection state backing the tab + commands. */
export const whatsappStore = createStore({
  status: "disconnected",
  qr: null,
  pairingCode: null,
  jid: null,
  error: null,
  log: [],
});
