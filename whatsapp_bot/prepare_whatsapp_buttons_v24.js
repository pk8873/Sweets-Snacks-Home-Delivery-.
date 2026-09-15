import fs from "node:fs";

const file = "whatsapp_bot/index.js";
const marker = "WHATSAPP_BUTTONS_FIX_V24";

let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp buttons fix V24 already applied.");
  process.exit(0);
}

const importAnchor = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion } from "@whiskeysockets/baileys";';
const importReplacement = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, proto, generateWAMessageFromContent } from "@whiskeysockets/baileys";';

if (!source.includes(importAnchor)) {
  throw new Error("Unable to locate Baileys import for V24.");
}
source = source.replace(importAnchor, importReplacement);

const buttonsStart = source.indexOf("async function buttons(");
const listStart = source.indexOf("async function list(");

if (buttonsStart < 0 || listStart < 0 || listStart <= buttonsStart) {
  throw new Error("Unable to locate WhatsApp buttons/list functions for V24.");
}

const nextAfterList = source.indexOf("\nasync function ", listStart + 1);
const listEnd = nextAfterList >= 0 ? nextAfterList : source.length;

const buttonsFunction = `async function buttons(sock, jid, text, items) {
  // ${marker}: build the WhatsApp Native Flow message through Baileys proto
  // instead of passing interactiveMessage directly to sendMessage().
  const clean = (items || [])
    .filter(x => x && x.id && x.text)
    .slice(0, 10);

  if (!clean.length) {
    await sock.sendMessage(jid, { text: String(text || "") });
    return;
  }

  const nativeButtons = clean.map(x => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.text).slice(0, 20),
      id: String(x.id).slice(0, 200)
    })
  }));

  const message = generateWAMessageFromContent(jid, {
    viewOnceMessage: proto.Message.ViewOnceMessage.create({
      message: proto.Message.create({
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({
            text: String(text || "")
          }),
          footer: proto.Message.InteractiveMessage.Footer.create({
            text: "Sweet & Snacks"
          }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: nativeButtons,
            messageParamsJson: ""
          })
        })
      })
    })
  }, { userJid: sock.user?.id });

  await sock.relayMessage(jid, message.message, { messageId: message.key.id });
}
`;

const listFunction = `async function list(sock, jid, title, text, rows) {
  // ${marker}: use the same native quick-reply transport for list-style menus.
  const clean = (rows || [])
    .filter(x => x && (x.id || x.rowId) && (x.title || x.text))
    .slice(0, 10)
    .map(x => ({
      id: String(x.id || x.rowId),
      text: String(x.title || x.text)
    }));

  await buttons(sock, jid, text || title || "Sweet & Snacks", clean);
}
`;

source = source.slice(0, buttonsStart) + buttonsFunction + listFunction + source.slice(listEnd);

fs.writeFileSync(file, source);
console.log("WhatsApp buttons fix V24 applied.");
console.log("V24 uses generateWAMessageFromContent + proto.InteractiveMessage + relayMessage.");
`;

fs.writeFileSync(file, source);
console.log("WhatsApp buttons fix V24 applied.");
console.log("V24 uses generateWAMessageFromContent + proto.InteractiveMessage + relayMessage.");
