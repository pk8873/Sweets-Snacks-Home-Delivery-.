import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V52";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V52 already applied; nothing to do.");
  process.exit(0);
}

// V52 is intentionally limited to the WhatsApp interactive-message transport.
// It keeps the existing business handlers and action IDs unchanged.
// V51 already introduced the correct low-level Native Flow approach; V52 makes
// that relay more defensive by retrying without optional extra nodes before the
// existing plain-text fallback is used.
if (!source.includes("WHATSAPP_RUNTIME_FIX_V51") || !source.includes("async function relayNativeFlow")) {
  throw new Error("V52 requires the V51 Native Flow relay to be present.");
}

const start = source.indexOf("async function relayNativeFlow");
const end = source.indexOf("async function buttons", start);
if (start < 0 || end < 0 || start >= end) {
  throw new Error("V52 could not locate relayNativeFlow/buttons boundaries.");
}

const replacement = `async function relayNativeFlow(sock, jid, text, items, title = "") {
  const clean = items.filter(Boolean);
  if (!clean.length) return;

  const buttons = clean.map(x => proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
    name: String(x.name || "quick_reply"),
    buttonParamsJson: JSON.stringify(x.params || {}),
  }));

  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.create({
      text: String(text || ""),
    }),
    footer: proto.Message.InteractiveMessage.Footer.create({
      text: "Sweet & Snacks",
    }),
    ...(title ? {
      header: proto.Message.InteractiveMessage.Header.create({
        title: String(title).slice(0, 60),
        hasMediaAttachment: false,
      }),
    } : {}),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons,
      messageParamsJson: "{}",
      messageVersion: 1,
    }),
  });

  const userJid = sock.user?.id;
  if (!userJid) throw new Error("WhatsApp bot JID is not available for native-flow relay.");

  const waMessage = generateWAMessageFromContent(jid, { interactiveMessage }, { userJid });
  const messageId = waMessage.key.id;

  const botNode = { tag: "bot", attrs: { biz_bot: "1" } };
  const bizNode = nativeFlowBizNode();

  try {
    await sock.relayMessage(jid, waMessage.message, {
      messageId,
      additionalNodes: [botNode, bizNode],
    });
  } catch (firstError) {
    logger.warn({ error: firstError?.message || firstError }, "Native Flow relay with optional nodes failed; retrying");
    await sock.relayMessage(jid, waMessage.message, { messageId });
  }
}

`;

source = source.slice(0, start) + replacement + source.slice(end);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V52 applied; defensive Native Flow relay retry + syntax check passed.");
