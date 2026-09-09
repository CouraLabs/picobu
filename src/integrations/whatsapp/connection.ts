import { mkdirSync, rmSync } from "node:fs";
import P from "pino";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { options } from "@config/options.ts";
import { whatsappStore } from "@integrations/whatsapp/whatsapp-store.ts";
import { emitInbound } from "@integrations/whatsapp/bus.ts";
import { recordWwpContacts } from "@integrations/whatsapp/contacts.ts";
import { isPhoneAllowed, jidToPhone, phoneToJid } from "@integrations/whatsapp/phone.ts";
type BaileysSocket = ReturnType<typeof makeWASocket>;

export const whatsappAuthDir = (): string => `${options.app.systemDir}/whatsapp/auth`;
let sock: ReturnType<typeof makeWASocket> | null = null;
let connectPromise: Promise<void> | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let pairedPhone = "";
let pairedLid = "";

export const AGENT_ECHO_PREFIX = "\u200B";
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 3_000;
const log = (message: string): void => {
  whatsappStore.trigger.log({ message });
};

export const isConnected = (): boolean =>
  whatsappStore.getSnapshot().context.status === "connected";

export const isSocketActive = (): boolean => sock !== null;

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
  try {
    mkdirSync(whatsappAuthDir(), { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(whatsappAuthDir());
    const s = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Picobu"),
      printQRInTerminal: false,
      logger: P({ level: "silent" }),
      getMessage: async () => undefined,
    });
    sock = s;
    s.ev.on("creds.update", saveCreds);
    s.ev.on("connection.update", (update) => handleConnectionUpdate(s, update));
    s.ev.on("messages.upsert", ({ messages }) => handleIncoming(messages));
    s.ev.on("contacts.upsert", (contacts) => void recordWwpContacts(contacts.map(toContactInput)));
    s.ev.on("contacts.update", (contacts) => void recordWwpContacts(contacts.map(toContactInput)));
    s.ev.on("messaging-history.set", ({ contacts, chats }) =>
      void recordWwpContacts([
        ...contacts.filter((c) => !c.id?.endsWith("@g.us")).map(toContactInput),
        ...chats.filter((c) => c.id && !c.id.endsWith("@g.us")).map(toChatContactInput),
      ]),
    );
  } catch (error) {
    sock = null;
    whatsappStore.trigger.setError({
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const sendText = async (phone: string, text: string): Promise<void> => {
  if (!sock) throw new Error("WhatsApp is not connected — open the WhatsApp tab to pair");
  const jid = phoneToJid(phone);
  await sock.sendMessage(jid, { text: `${AGENT_ECHO_PREFIX}${text}` });
  void recordWwpContacts([{ phone, lastAt: Date.now() }]);
  log(`Sent message to ${jidToPhone(jid)}`);
};

export const requestPairingCode = async (phone: string): Promise<string> => {
  if (!sock) throw new Error("Click Connect first, then request a pairing code");
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new Error("Enter your phone number (digits only, with country code)");
  const code = await sock.requestPairingCode(digits);
  whatsappStore.trigger.setPairingCode({ code });
  log("Pairing code ready — enter it in WhatsApp → Linked devices → Link with phone number");
  return code;
};

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
      try {
        rmSync(whatsappAuthDir(), { recursive: true, force: true });
      } catch {
      }
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

const handleIncoming = (messages: readonly unknown[]): void => {
  for (const raw of messages) {
    const m = raw as BaileysMessage;
    if (!m.message || !m.key || !m.key.remoteJid) continue;
    const jid = m.key.remoteJid;
    if (jid === "status@broadcast" || jid.endsWith("@g.us")) continue;
    const isLidJid = jid.endsWith("@lid");
    if (isLidJid && !m.key.remoteJidAlt) continue;
    const phone = jidToPhone(isLidJid ? m.key.remoteJidAlt ?? jid : jid);
    if (!phone) continue;
    if (!isLidJid) {
      void recordWwpContacts([{ phone, name: m.pushName ?? null, lastAt: Date.now() }]);
    }
    const text = messageText(m.message);
    if (!text) continue;
    if (text.startsWith(AGENT_ECHO_PREFIX)) continue;
    if (m.key.fromMe && phone !== pairedPhone && phone !== pairedLid) continue;
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
    fromMe?: boolean | null;
  } | null;
  pushName?: string | null;
  message?: BaileysMessageBody | null;
};
type BaileysMessageBody = {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  ephemeralMessage?: { message?: BaileysMessageBody | null } | null;
  viewOnceMessage?: { message?: BaileysMessageBody | null } | null;
};

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

const toContactInput = (c: BaileysContact): { phone: string; name: string | null; lastAt: number } => ({
  phone: c.phoneNumber ? jidToPhone(c.phoneNumber) : jidToPhone(c.id ?? ""),
  name: c.name ?? c.notify ?? null,
  lastAt: 0,
});

type BaileysChat = {
  id?: string | null;
  name?: string | null;
};

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
