export type WhatsAppStatus = "disconnected" | "connecting" | "awaiting-qr" | "connected" | "error";
export type WhatsAppLogEntry = { at: number; message: string };
export type WhatsAppState = {
  status: WhatsAppStatus;
  qr: string | null;
  pairingCode: string | null;
  jid: string | null;
  error: string | null;
  log: WhatsAppLogEntry[];
};
const MAX_LOG = 100;
export type WhatsAppStoreState = WhatsAppState;


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
      log: define((s, e: { message: string }) => ({
        ...s,
        log: [...s.log, { at: Date.now(), message: e.message }].slice(-MAX_LOG),
      })),
    },
  };
  return store;
};


export const whatsappStore = createStore({
  status: "disconnected",
  qr: null,
  pairingCode: null,
  jid: null,
  error: null,
  log: [],
});
