---
name: baileys-wp
description: 'Build, integrate, and debug WhatsApp features using the Baileys library (@whiskeysockets/baileys). Use when: (1) connecting a WhatsApp account via QR code or pairing code, (2) sending or receiving messages (text, media, polls, reactions, locations, contacts, audio, video), (3) managing groups, chats, contacts, profile, or privacy settings, (4) handling Baileys events, auth state, sessions, reconnection, or media download/upload, (5) working on src/integrations/whatsapp-integration.ts or anything WhatsApp-related. Triggers on: "whatsapp", "baileys", "whiskeysockets", "send a whatsapp message", "qr code", "pairing code".'
---

# Baileys — WhatsApp Web API integration

Baileys (`@whiskeysockets/baileys`) is a WebSockets-based TypeScript library for interacting with the WhatsApp Web multi-device API. No Selenium/Chromium — it speaks to WhatsApp directly over a WebSocket.

- Installed in this repo: **v7.x (7.0.0-rc14)** — a release candidate with **breaking changes vs 6.x** (see below).
- Repo: https://github.com/WhiskeySockets/Baileys — Docs: https://baileys.wiki/docs/intro/
- Local source of truth: `node_modules/@whiskeysockets/baileys/lib/` (types in `lib/Types/`, `lib/Utils/`, `lib/Socket/`). Verify every signature against these types before writing code — internet examples frequently target 6.x.
- This repo has a stub at `src/integrations/whatsapp-integration.ts` — implement integrations there, following project conventions in `AGENTS.md` (Bun APIs, ESM, strict TS, `import type`).

## Critical version-7 changes (do NOT copy 6.x tutorials blindly)

1. **`printQRInTerminal` is deprecated.** It only logs a warning; no QR is printed. Always listen to `connection.update` yourself and render `update.qr` (e.g. with `qrcode-terminal`).
2. **`makeInMemoryStore` and `store.bind(sock.ev)` are REMOVED.** Implement your own persistence and pass `getMessage: async (key) => ...` in the socket config — it powers message retries and poll-vote decryption.
3. Always wrap signal key stores with `makeCacheableSignalKeyStore` for performance.
4. Reconnection is YOUR responsibility via `connection.update` + `DisconnectReason` (boilerplate below).

## Core setup (canonical boilerplate)

```ts
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu("My App"),
    // recommended: powers retries + poll decryption
    getMessage: async (key) => /* fetch from your store */ undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      // v7: render it yourself, e.g. qrcode.generate(qr, { small: true })
    }
    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) connectToWhatsApp(); // reconnect unless logged out
    } else if (connection === "open") {
      console.log("opened connection");
    }
  });

  sock.ev.on("messages.upsert", async (event) => {
    // ALWAYS loop over event.messages; never assume a single message
    for (const m of event.messages) {
      if (!m.message) return; // ignore protocol/ephemeral wrappers
      await sock.sendMessage(m.key.remoteJid!, { text: "Hello World" });
    }
  });
}

connectToWhatsApp();
```

First connection: `connection.update` fires once asking for a restart, then history arrives on `messaging.history-set`.

## Utility functions

`getContentType(message)` · `getDevice(message)` · `makeCacheableSignalKeyStore(store, logger)` · `downloadContentFromMessage(...)` · `downloadMediaMessage(...)` · `getAggregateVotesInPollMessage(...)` · `Browsers.*` · `DisconnectReason` · `WA_DEFAULT_EPHEMERAL`.

## Connecting: pairing code & full history

**Pairing code** (no QR scanner needed; one device only):
```ts
const sock = makeWASocket({});
if (!sock.authState.creds.registered) {
  // digits only, with country code: e.g. "15551234567" (no +, (), -)
  const code = await sock.requestPairingCode("15551234567");
  console.log(code); // enter in WhatsApp > Linked Devices > Link with phone number
}
```

**Full history:** set `syncFullHistory: true` and emulate desktop: `browser: Browsers.macOS("Desktop")` (Windows/Ubuntu also work).

## Important socket config options

- `cachedGroupMetadata: async (jid) => groupCache.get(jid)` — strongly recommended for groups; refresh from `groups.update` / `group-participants.update` events.
- `getMessage: async (key) => store.getMessage(key)` — needed for reliable retries and decrypting poll votes.
- `markOnlineOnConnect: false` — keep push notifications working on the phone (an "online" desktop client suppresses them).
- `syncFullHistory`, `browser`, `qrTimeout`, `keepAliveIntervalMs`, `logger`, `linkPreviewImageThumbnailWidth` — see the full `SocketConfig` type in `node_modules/@whiskeysockets/baileys/lib/Types/Socket.d.ts`.

## Saving & restoring sessions

```ts
import { useMultiFileAuthState } from "@whiskeysockets/baileys";
const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
const sock = makeWASocket({ auth: state }); // logs in without QR when creds are valid
sock.ev.on("creds.update", saveCreds); // REQUIRED: persist keys on every update
```

- `creds.update` fires whenever signal session keys change (every sent/received message). Not saving them breaks future message delivery.
- For production, back auth state with a database; serialize buffers with the `BufferJSON` utility.

## Handling events

Baileys uses typed EventEmitter syntax. All event names/payloads are in the `BaileysEventMap` type (`lib/Types/Events.d.ts`).

```ts
sock.ev.on("messages.upsert", ({ messages }) => { /* ... */ });
```

**Decrypt poll votes** (poll votes are encrypted, handled in `messages.update`):
```ts
sock.ev.on("messages.update", async (event) => {
  for (const { key, update } of event) {
    if (update.pollUpdates) {
      const pollCreation = await getMessage(key); // from YOUR store
      if (pollCreation) {
        const agg = getAggregateVotesInPollMessage({
          message: pollCreation,
          pollUpdates: update.pollUpdates,
        });
      }
    }
  }
});
```

## WhatsApp IDs (jids)

- Person: `[country code][number]@s.whatsapp.net` (e.g. `15551234567@s.whatsapp.net`)
- Group: `123456789-123345@g.us`
- Broadcast list: `[timestamp]@broadcast` — Stories/status: `status@broadcast`
- `jid` never includes `+` or formatting characters.

## Sending messages

One function for everything: `sock.sendMessage(jid, content: AnyMessageContent, options?: MiscMessageGenerationOptions)`. See those types in the installed package for the full union.

```ts
// text
await sock.sendMessage(jid, { text: "hello" });
// quote (works with all types)
await sock.sendMessage(jid, { text: "hello" }, { quoted: message });
// mention (with @number in text)
await sock.sendMessage(jid, { text: "@15551234567", mentions: ["15551234567@s.whatsapp.net"] });
// forward (needs a WAMessage object)
await sock.sendMessage(jid, { forward: msg });
// location
await sock.sendMessage(jid, { location: { degreesLatitude: 24.12, degreesLongitude: 55.11 } });
// reaction (empty text removes it)
await sock.sendMessage(jid, { react: { text: "💖", key: message.key } });
// pin a message (0 = unpin; time 86400 | 604800 | 2592000 seconds)
await sock.sendMessage(jid, { pin: { type: 1, time: 86400, key: message.key } });
// poll
await sock.sendMessage(jid, { poll: { name: "My Poll", values: ["A", "B"], selectableCount: 1 } });
```

vCard contact card: `contacts: { displayName: "Jeff", contacts: [{ vcard }] }` with
`BEGIN:VCARD\nVERSION:3.0\nFN:Jeff Singh\nORG:Ashoka Uni;\nTEL;type=CELL;type=VOICE;waid=15551234567:+1 555 123 4567\nEND:VCARD`

**Link previews** are generated for `text` containing URLs (tune via `linkPreviewImageThumbnailWidth`).

**Media messages** — pass `{ url }`, `{ stream }`, or a `Buffer` (`WAMediaUpload`); prefer url/stream to keep memory low:

```ts
await sock.sendMessage(jid, { image: { url: "./img.png" }, caption: "hello" });
await sock.sendMessage(jid, { video: { url: "./v.mp4" }, caption: "hi", ptv: false }); // ptv: true = video note
await sock.sendMessage(jid, { video: { url: "./a.gif" }, gifPlayback: true });         // gifs = mp4 + flag
await sock.sendMessage(jid, { audio: { url: "./a.mp3" }, mimetype: "audio/mp4" });     // convert to ogg/opus via ffmpeg for all devices: ffmpeg -i in.mp4 -avoid_negative_ts make_zero -ac 1 out.ogg
await sock.sendMessage(jid, { image: { url: "./img.png" }, viewOnce: true, caption: "hi" }); // also video/audio
await sock.sendMessage(jid, { sticker: { url: "./sticker.webp" } });
```

Ephemeral per-message: `await sock.sendMessage(jid, { text: "hi" }, { ephemeralExpiration: WA_DEFAULT_EPHEMERAL })` (seconds: 86400 / 604800 / 7776000).

## Modify messages

```ts
const msg = await sock.sendMessage(jid, { text: "hello" });
await sock.sendMessage(jid, { delete: msg.key });                // delete for everyone
await sock.sendMessage(jid, { text: "updated", edit: msg.key }); // edit (all editable contents)
```

## Media manipulation

```ts
import { downloadMediaMessage, getContentType } from "@whiskeysockets/baileys";
if (getContentType(m.message) === "imageMessage") {
  const stream = await downloadMediaMessage(m, "stream", {}, {
    logger,
    reuploadRequest: sock.updateMediaMessage, // lets Baileys re-upload deleted media
  });
  stream.pipe(createWriteStream("./out.jpeg")); // or request "buffer"
}
```
- Re-upload expired media: `await sock.updateMediaMessage(msg)` — WhatsApp deletes old media from its servers; another device holding it must re-upload.
- Auto thumbnails for images/stickers need `jimp` or `sharp` installed; video thumbnails need `ffmpeg` on the system.

## Calls, read receipts & presence

```ts
// reject call — callId/callFrom come from the "call" event
await sock.rejectCall(callId, callFrom);
// mark messages read (you must track unread keys yourself; no whole-chat read)
await sock.readMessages([key]);
// presence: "available" | "unavailable" | "typing" | "recording" — expires ~10s
await sock.sendPresenceUpdate("available", jid);
await sock.sendPresenceUpdate("unavailable"); // hides online status on the phone too
```

## Modifying chats (`sock.chatModify`)

All via `sock.chatModify(modification, jid)` — malformed updates can log you out of all devices.

```ts
await sock.chatModify({ archive: true, lastMessages: [lastMsgInChat] }, jid);       // archive
await sock.chatModify({ mute: 8 * 60 * 60 * 1000 }, jid);                           // mute 8h (604800000 = 7d; null = unmute)
await sock.chatModify({ markRead: false, lastMessages: [lastMsgInChat] }, jid);     // mark unread
await sock.chatModify({ pin: true }, jid);                                          // pin chat (false = unpin)
await sock.chatModify({ delete: true, lastMessages: [{ key, messageTimestamp }] }, jid); // delete chat
await sock.chatModify({ clear: { messages: [{ id, fromMe, timestamp }] } }, jid);   // delete for me
await sock.chatModify({ star: { messages: [{ id, fromMe: true }], star: true } }, jid); // star (false = unstar)
// disappearing messages: on
await sock.sendMessage(jid, { disappearingMessagesInChat: WA_DEFAULT_EPHEMERAL });  // off: false
```


## User queries

```ts
const [result] = await sock.onWhatsApp(jid);                  // does the number exist? result.exists / result.jid
await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp); // needs oldest message; max 50/query; arrives on messaging.history-set
await sock.fetchStatus(jid);                                  // user status
await sock.profilePictureUrl(jid);                            // low res ("image" for high res)
await sock.getBusinessProfile(jid);                           // { description, category, ... }
await sock.presenceSubscribe(jid);                            // then listen on "presence.update"
```

## Profile changes

```ts
await sock.updateProfileStatus("Hello World!");
await sock.updateProfileName("My name");
await sock.updateProfilePicture(jid, { url: "./new.jpeg" });  // groups too
await sock.removeProfilePicture(jid);                         // groups too
```

## Groups

Group property changes require admin.

```ts
// create
const group = await sock.groupCreate("My Group", ["1234@s.whatsapp.net", "4564@s.whatsapp.net"]);
// add/remove/promote/demote: "add" | "remove" | "promote" | "demote"
await sock.groupParticipantsUpdate(jid, ["1234@s.whatsapp.net"], "add");
await sock.groupUpdateSubject(jid, "New Name");
await sock.groupUpdateDescription(jid, "New Description");
await sock.groupSettingUpdate(jid, "announcement");  // admin-only messages ("not_announcement" = everyone)
await sock.groupSettingUpdate(jid, "locked");        // admin-only settings ("unlocked" = everyone)
await sock.groupLeave(jid);                          // throws on failure
const code = await sock.groupInviteCode(jid);        // invite link = "https://chat.whatsapp.com/" + code
await sock.groupRevokeInvite(jid);                   // rotate invite code
await sock.groupAcceptInvite(code);                  // code WITHOUT the https://chat.whatsapp.com/ prefix
await sock.groupGetInviteInfo(code);                 // group info from invite code
await sock.groupMetadata(jid);                       // { id, subject, desc, participants, ... }
await sock.groupAcceptInviteV4(jid, groupInviteMessage);
await sock.groupRequestParticipantsList(jid);        // join requests
await sock.groupRequestParticipantsUpdate(jid, ["1234@s.whatsapp.net"], "approve"); // or "reject"
await sock.groupFetchAllParticipating();             // all your groups' metadata
await sock.groupToggleEphemeral(jid, 86400);         // ephemeral: 0 | 86400 | 604800 | 7776000
await sock.groupMemberAddMode(jid, "all_member_add"); // or "admin_add"
```

## Privacy

```ts
await sock.updateBlockStatus(jid, "block");          // or "unblock"
await sock.fetchPrivacySettings(true);
await sock.fetchBlocklist();
// value: "all" | "contacts" | "contact_blacklist" | "none"
await sock.updateLastSeenPrivacy("all");
await sock.updateOnlinePrivacy("all");               // or "match_last_seen"
await sock.updateProfilePicturePrivacy("all");
await sock.updateStatusPrivacy("all");
await sock.updateReadReceiptsPrivacy("all");         // or "none"
await sock.updateGroupsAddPrivacy("all");            // or "contacts" | "contact_blacklist"
await sock.updateDefaultDisappearingMode(86400);     // 0 = off
```

## Broadcast lists & stories

```ts
// story: jid = status@broadcast; body must be extendedText/image/video/voice
await sock.sendMessage(
  "status@broadcast",
  { image: { url }, caption },
  { backgroundColor, font, statusJidList, broadcast: true }
);
// broadcast list info (WA Web cannot CREATE broadcast lists, only use/delete)
const bList = await sock.getBroadcastListInfo("1234@broadcast");
```

## Custom functionality / debugging

- Debug logging: pass `logger: P({ level: "debug" })` (pino) to `makeWASocket` to see all raw WhatsApp frames, including unhandled ones.
- Wire protocol: frames are `{ tag, attrs, content }` binary nodes (`lib/WABinary/readme.md`). Study the Libsignal/Noise protocols for the crypto layer.
- Raw WS callbacks: `sock.ws.on("CB:edge_routing", (node: BinaryNode) => {})`; refine with attrs: `"CB:edge_routing,id:abcd"` and `"CB:edge_routing,id:abcd,routing_info"`. See `onMessageReceived` in the socket source for how events fire.

## Etiquette & legal

Baileys is unofficial and not affiliated with WhatsApp. Do not spam or use for bulk/stalkerware messaging; automated messaging violates WhatsApp ToS and risks account bans. Use at your own discretion.

