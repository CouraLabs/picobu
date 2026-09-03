import { createStore } from "@xstate/store";

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

/** Live WhatsApp connection state backing the tab + commands. */
export const whatsappStore = createStore({
  context: {
    status: "disconnected",
    qr: null,
    pairingCode: null,
    jid: null,
    error: null,
    log: [],
  } as WhatsAppState,
  on: {
    setStatus: (s, e: { status: WhatsAppStatus }) => ({ ...s, status: e.status }),
    setQr: (s, e: { qr: string | null }) => ({
      ...s,
      qr: e.qr,
      status: e.qr ? "awaiting-qr" : s.status,
    }),
    setPairingCode: (s, e: { code: string | null }) => ({ ...s, pairingCode: e.code }),
    setConnected: (s, e: { jid: string | null }) => ({
      ...s,
      status: "connected",
      qr: null,
      pairingCode: null,
      jid: e.jid,
      error: null,
    }),
    setError: (s, e: { error: string }) => ({ ...s, status: "error", error: e.error }),
    /** Append an activity line (capped at `MAX_LOG`). */
    log: (s, e: { message: string }) => ({
      ...s,
      log: [...s.log, { at: Date.now(), message: e.message }].slice(-MAX_LOG),
    }),
  },
});
