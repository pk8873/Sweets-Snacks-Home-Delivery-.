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
// The relay must also include WhatsApp's native-flow biz/bot nodes; without
// those nodes WhatsApp Web can downgrade the message to plain text.
const oldImport = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion } from "@whiskeysockets/baileys";';
const newImport = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, generateWAMessageFromContent, proto, isJidGroup } from "@whiskeysockets/baileys";';
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
      messageParamsJson: "{}",
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

  const privacyModeTs = String(Math.floor(Date.now() / 1000) - 77980457);
  const bizNode = {
    tag: "biz",
    attrs: {
      actual_actors: "2",
      host_storage: "2",
      privacy_mode_ts: privacyModeTs,
    },
    content: [
      {
        tag: "interactive",
        attrs: { type: "native_flow", v: "1" },
        content: [
          {
            tag: "native_flow",
            attrs: { v: "9", name: "mixed" },
          },
        ],
      },
      {
        tag: "quality_control",
        attrs: { source_type: "third_party" },
      },
    ],
  };
  const botNode = { tag: "bot", attrs: { biz_bot: "1" } };
  const additionalNodes = isJidGroup(jid) ? [bizNode] : [botNode, bizNode];

  await sock.relayMessage(jid, message.message, {
    messageId: message.key.id,
    additionalNodes,
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
console.log("WhatsApp runtime fix V35 applied; low-level Native Flow relay + biz/bot relay nodes + safe fallback + syntax check passed.");
