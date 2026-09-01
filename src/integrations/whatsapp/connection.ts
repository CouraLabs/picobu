import { mkdirSync } from "node:fs";
import P from "pino";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { options } from "../../libs/options";
import { whatsappStore } from "./whatsapp-store";
import { emitInbound } from "./bus";
import { recordWwpContacts } from "./contacts";
import { isPhoneAllowed, jidToPhone, phoneToJid } from "./phone";

type BaileysSocket = ReturnType<typeof makeWASocket>;

/** Baileys auth state lives under `~/.picobu/whatsapp/auth` so the session
 * survives app restarts — a reconnect never needs a new QR (until logged out). */
export const whatsappAuthDir = (): string => `${options.app.systemDir}/whatsapp/auth`;

let sock: ReturnType<typeof makeWASocket> | null = null;
/** In-flight connect promise: concurrent callers (multiple web tabs) reuse it. */
let connectPromise: Promise<void> | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
/** Phone digits of the paired device; its messages are always allowed. */
let pairedPhone = "";
/**
 * LID digits of the paired device. WhatsApp is migrating accounts to LID
 * addressing: some messages (notably "Message yourself" self-chats) arrive
 * with `key.remoteJid` pointed at `<lid>@lid` instead of the phone JID, so
 * self-recognition must check both.
 */
let pairedLid = "";

/**
 * Invisible sentinel (zero-width space) prepended to every agent-sent text.
 * Agent sends echo back into `messages.upsert` (`fromMe` on the same socket),
 * and the prefix lets `handleIncoming` recognize that echo as agent-originated
 * and drop it — otherwise a self-chat reply would loop back into the
 * persistent session.
 */
export const AGENT_ECHO_PREFIX = "\u200B";

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 3_000;

const log = (message: string): void => {
  whatsappStore.trigger.log({ message });
};

/** True while the socket exists and reports an open connection. */
export const isConnected = (): boolean =>
  whatsappStore.getSnapshot().context.status === "connected";

/** True once a socket exists (even mid-handshake). */
export const isSocketActive = (): boolean => sock !== null;

/**
 * Connect (or reuse the existing socket). Credentials persist under
 * `~/.picobu/whatsapp/auth`, so after the first QR pairing this resolves
 * without a QR code.
 */
export const connectToWhatsApp = async (): Promise<void> => {
  if (sock) return;
  if (connectPromise) return connectPromise;
  connectPromise = doConnect().finally(() => {
    connectPromise = null;
  });
  return connectPromise;
};

const doConnect = async (): Promise<void> => {
  whatsappStore.trigger.setStatus({ status: "connecting" });
  mkdirSync(whatsappAuthDir(), { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(whatsappAuthDir());
  const s = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu("Picobu"),
    printQRInTerminal: false,
    // Baileys' default pino logger writes JSON frames to stdout, which would
    // corrupt the TUI — route everything into a silent logger instead.
    logger: P({ level: "silent" }),
    // v7: required callback powering message retries / poll decryption.
    getMessage: async () => undefined,
  });
  sock = s;

  s.ev.on("creds.update", saveCreds);
  s.ev.on("connection.update", (update) => handleConnectionUpdate(s, update));
  s.ev.on("messages.upsert", ({ messages }) => handleIncoming(messages));
  // Contact names from live traffic (saved name / push name) keep the book fresh.
  s.ev.on("contacts.upsert", (contacts) => void recordWwpContacts(contacts.map(toContactInput)));
  s.ev.on("contacts.update", (contacts) => void recordWwpContacts(contacts.map(toContactInput)));
  // The full synced contact book arrives with history sync (initial pairing or
  // reconnect with an existing session).
  s.ev.on("messaging-history.set", ({ contacts, chats }) =>
    void recordWwpContacts([
      ...contacts.map(toContactInput),
      ...chats.map(toChatContactInput),
    ]),
  );
};

/** Send a text message to a bare phone number; throws when not connected. */
export const sendText = async (phone: string, text: string): Promise<void> => {
  if (!sock) throw new Error("WhatsApp is not connected — open the WhatsApp tab to pair");
  const jid = phoneToJid(phone);
  // The sentinel marks the text as agent-originated so its incoming echo is
  // dropped by handleIncoming instead of looping back into the session.
  await sock.sendMessage(jid, { text: `${AGENT_ECHO_PREFIX}${text}` });
  void recordWwpContacts([{ phone, lastAt: Date.now() }]);
  log(`Sent message to ${jidToPhone(jid)}`);
};

/**
 * Request a numeric pairing code as a QR-free alternative: enter it in
 * WhatsApp → Linked devices → "Link with phone number". Requires a socket
 * started with Connect and digits-only phone with country code.
 */
export const requestPairingCode = async (phone: string): Promise<string> => {
  if (!sock) throw new Error("Click Connect first, then request a pairing code");
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new Error("Enter your phone number (digits only, with country code)");
  const code = await sock.requestPairingCode(digits);
  whatsappStore.trigger.setPairingCode({ code });
  log("Pairing code ready — enter it in WhatsApp → Linked devices → Link with phone number");
  return code;
};

/**
 * Handle Baileys connection lifecycle: surface the QR, mark connected, and
 * own reconnection (per v7, reconnection is our responsibility).
 */
const handleConnectionUpdate = (s: BaileysSocket, update: {
  connection?: "connecting" | "open" | "close";
  lastDisconnect?: { error?: unknown };
  qr?: string;
}): void => {
  if (update.qr) {
    whatsappStore.trigger.setQr({ qr: update.qr });
    log("QR code ready — scan it on the WhatsApp tab");
    return;
  }
  if (update.connection === "open") {
    reconnectAttempts = 0;
    // `user` is a Baileys `Contact`: `id` is the JID (PN or LID format),
    // `phoneNumber` is always the real phone JID, `lid` the LID JID.
    pairedPhone = jidToPhone(s.user?.phoneNumber ?? s.user?.id ?? "");
    pairedLid = jidToPhone(s.user?.lid ?? "");
    whatsappStore.trigger.setConnected({ jid: s.user?.id ?? null });
    log(`Connected as ${s.user?.name ?? s.user?.id ?? "unknown"}`);
    return;
  }
  if (update.connection === "close") {
    sock = null;
    const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
      ?.output?.statusCode;
    if (code === DisconnectReason.loggedOut) {
      whatsappStore.trigger.setStatus({ status: "disconnected" });
      whatsappStore.trigger.setQr({ qr: null });
      log("Logged out — a new QR code is required to connect again");
      return;
    }
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      whatsappStore.trigger.setError({ error: "Reconnect attempts exhausted" });
      log("Gave up reconnecting");
      return;
    }
    reconnectAttempts += 1;
    whatsappStore.trigger.setStatus({ status: "connecting" });
    log(`Connection lost — reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connectToWhatsApp();
    }, RECONNECT_DELAY_MS);
  }
};

/** Filter inbound messages against the allow-list and forward to the bus. */
const handleIncoming = (messages: readonly unknown[]): void => {
  for (const raw of messages) {
    const m = raw as BaileysMessage;
    if (!m.message || !m.key || !m.key.remoteJid) continue;
    const jid = m.key.remoteJid;
    if (jid === "status@broadcast" || jid.endsWith("@g.us")) continue;
    // WhatsApp's LID migration: some inbound JIDs (notably self-chats) are
    // `<lid>@lid`; the phone JID rides along in `key.remoteJidAlt`.
    const isLidJid = jid.endsWith("@lid");
    const phone = jidToPhone(isLidJid ? m.key.remoteJidAlt ?? jid : jid);
    // Don't pollute the contacts book with LID digits when no PN is known.
    if (!isLidJid) {
      void recordWwpContacts([{ phone, name: m.pushName ?? null, lastAt: Date.now() }]);
    }
    const text = messageText(m.message);
    if (!text) continue;
    // Agent-sent messages carry the sentinel and echo back as inbound
    // (`fromMe`) upserts — never re-submit them to the persistent session.
    if (text.startsWith(AGENT_ECHO_PREFIX)) continue;
    // Outbound messages the user sends from their own phone also arrive as
    // `fromMe` upserts with the *recipient's* JID. Those are not prompts:
    // without this guard, texting an allowed number from the phone app would
    // submit the user's own message to the agent (which may then reply to
    // that person). Only genuine self-chats ("Message yourself") pass.
    if (m.key.fromMe && phone !== pairedPhone && phone !== pairedLid) continue;
    // The paired phone is always allowed (either identity): it's the
    // "Message yourself" channel.
    const allowed =
      isPhoneAllowed(phone, options.whatsapp.allowedNumbers) ||
      phone === pairedPhone ||
      phone === pairedLid;
    if (!allowed) {
      log(`Ignored message from non-allowed number ${phone}`);
      continue;
    }
    log(`Message from ${phone}`);
    emitInbound({
      source: "whatsapp",
      title: `WhatsApp Answer to +${phone} using wwp-msg`,
      text,
    });
  }
};

type BaileysMessage = {
  key: {
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    /** True for messages sent by any of our own devices (echoes of our sends). */
    fromMe?: boolean | null;
  } | null;
  pushName?: string | null;
  message?: BaileysMessageBody | null;
};

type BaileysMessageBody = {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  /** Disappearing messages wrap the real content one level deeper. */
  ephemeralMessage?: { message?: BaileysMessageBody | null } | null;
  /** View-once (and linked-preview re-wraps) hide the content the same way. */
  viewOnceMessage?: { message?: BaileysMessageBody | null } | null;
};

/** Plain text of an inbound message, unwrapping ephemeral/view-once shells. */
const messageText = (message: BaileysMessageBody | null | undefined): string | null => {
  const inner = message?.ephemeralMessage?.message ?? message?.viewOnceMessage?.message ?? message;
  return inner?.conversation ?? inner?.extendedTextMessage?.text ?? null;
};

type BaileysContact = {
  id?: string | null;
  phoneNumber?: string | null;
  name?: string | null;
  notify?: string | null;
};

/** Map a Baileys contact onto a contacts-book entry (personal JIDs only). */
const toContactInput = (c: BaileysContact): { phone: string; name: string | null; lastAt: number } => ({
  phone: c.phoneNumber ? jidToPhone(c.phoneNumber) : jidToPhone(c.id ?? ""),
  name: c.name ?? c.notify ?? null,
  lastAt: 0,
});

type BaileysChat = {
  id?: string | null;
  name?: string | null;
};

/** Personal chats carry the name the user saved for that number. */
const toChatContactInput = (c: BaileysChat): { phone: string; name: string | null; lastAt: number } => ({
  phone: jidToPhone(c.id ?? ""),
  name: c.name ?? null,
  lastAt: 0,
});

export const disconnectFromWhatsApp = (): void => {
  if (!sock) return;
  try {
    sock.end(undefined);
  } catch {
    /* socket already gone */
  }
  sock = null;
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  whatsappStore.trigger.setStatus({ status: "disconnected" });
  whatsappStore.trigger.setQr({ qr: null });
  whatsappStore.trigger.setPairingCode({ code: null });
  log("Disconnected by user");
};


