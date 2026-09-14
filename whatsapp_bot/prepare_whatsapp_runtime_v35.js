import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V35";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V35 already applied; nothing to do.");
  process.exit(0);
}

// V23's direct interactiveMessage send path is not accepted reliably by the
// pinned Baileys build. V35 sends Native Flow through the protobuf + relay path.
// V27 may already have installed the required Native Flow imports, so accept
// either the original import or the already-patched import instead of failing.
const oldImport = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion } from "@whiskeysockets/baileys";';
const newImport = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, generateWAMessageFromContent, proto } from "@whiskeysockets/baileys";';
if (source.includes(oldImport)) {
  source = source.replace(oldImport, newImport);
} else if (!source.includes("generateWAMessageFromContent") || !source.includes("proto")) {
  throw new Error("V35 could not locate a compatible Baileys import line.");
}

function replaceRequired(pattern, replacement, name) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`V35 could not locate ${name}`);
  source = next;
}

replaceRequired(
  /async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}\nasync function list/,
  String.raw`async function sendNativeFlow(sock, jid, bodyText, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  if (!clean.length) return;

  const buttons = clean.map((x) =>
    proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
      name: "quick_reply",
      buttonParamsJson: JSON.stringify({
        display_text: String(x.text || "").slice(0, 20),
        id: String(x.id || "").slice(0, 200),
      }),
    })
  );

  const interactiveMessage = proto.Message.InteractiveMessage.create({
    header: proto.Message.InteractiveMessage.Header.create({
      title: "🍬 Sweet & Snacks",
      hasMediaAttachment: false,
    }),
    body: proto.Message.InteractiveMessage.Body.create({
      text: String(bodyText || ""),
    }),
    footer: proto.Message.InteractiveMessage.Footer.create({
      text: "Sweet & Snacks",
    }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons,
      messageParamsJson: "",
      messageVersion: 1,
    }),
    contextInfo: proto.ContextInfo.create({
      mentionedJid: [],
      groupMentions: [],
      statusAttributions: [],
    }),
  });

  const message = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: proto.MessageContextInfo.create({
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
      }),
      viewOnceMessage: proto.Message.FutureProofMessage.create({
        message: proto.Message.create({ interactiveMessage }),
      }),
    },
    { userJid: sock.user?.id || jid }
  );

  await sock.relayMessage(jid, message.message, {
    messageId: message.key.id,
  });
}

async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  try {
    await sendNativeFlow(sock, jid, text, clean);
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "V35 Native Flow button relay failed");
    // Text fallback guarantees the customer still gets a usable response.
    const fallback = clean.map((x, i) => (i + 1) + ". " + String(x.text || "")).join("\n");
    await sock.sendMessage(jid, { text: String(text || "") + "\n\n" + fallback });
  }
}
async function list`,
  "buttons()"
);

replaceRequired(
  /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}\nasync function home/,
  String.raw`async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return sock.sendMessage(jid, { text: String(text || "") });

  try {
    for (let start = 0; start < clean.length; start += 3) {
      const chunk = clean.slice(start, start + 3);
      const items = chunk.map((x) => ({
        id: x.id,
        text: x.title,
      }));
      await sendNativeFlow(
        sock,
        jid,
        start === 0 ? text : "More " + String(title || "options") + ":",
        items
      );
    }
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "V35 Native Flow list relay failed");
    const fallback = clean.map((x, i) => (i + 1) + ". " + String(x.title || "")).join("\n");
    await sock.sendMessage(jid, { text: String(text || "") + "\n\n" + fallback });
  }
}
async function home`,
  "list()"
);

source = "// " + marker + "\n" + source;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V35 applied; low-level Native Flow relay + safe fallback + syntax check passed.");
