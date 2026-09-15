import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V74";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V74 already applied; syntax check passed.");
  process.exit(0);
}

// V74 fixes only WhatsApp interactive transport. No Django/business logic is changed.
// Important: the previous high-level sendMessage({ interactiveMessage }) path throws
// "Invalid media type" in WhiskeySockets. We build the protobuf message directly and
// relay it with the required biz/bot nodes. We also use quick_reply for menu/list rows
// because single_select is not reliably rendered by WhatsApp Web.
if (!source.includes('from "@whiskeysockets/baileys";\nimport { proto, generateWAMessageFromContent, isJidGroup }')) {
  const importAnchor = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion } from "@whiskeysockets/baileys";';
  if (!source.includes(importAnchor)) throw new Error("V74 could not locate Baileys import.");
  source = source.replace(
    importAnchor,
    importAnchor + '\nimport { proto, generateWAMessageFromContent, isJidGroup } from "@whiskeysockets/baileys";'
  );
}

const startToken = "async function buttons(sock, jid, text, items)";
const endToken = "async function home(sock, jid)";
const start = source.indexOf(startToken);
const end = source.indexOf(endToken, start + startToken.length);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("V74 could not locate WhatsApp buttons/list transport block.");
}

const replacement = `async function sendNativeFlow(sock, jid, text, nativeButtons) {
  if (!nativeButtons.length) return;

  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.create({
      text: String(text || ""),
    }),
    footer: proto.Message.InteractiveMessage.Footer.create({
      text: "Sweet & Snacks",
    }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons: nativeButtons.map((button) =>
        proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
          name: String(button.name),
          buttonParamsJson: String(button.buttonParamsJson),
        })
      ),
      messageParamsJson: "{}",
      messageVersion: 1,
    }),
  });

  const userJid = sock.user?.id || sock.authState?.creds?.me?.id;
  if (!userJid) throw new Error("WhatsApp user JID is not available");

  const waMessage = generateWAMessageFromContent(
    jid,
    { interactiveMessage },
    { userJid }
  );

  const bizNode = {
    tag: "biz",
    attrs: {},
    content: [{
      tag: "interactive",
      attrs: { type: "native_flow", v: "1" },
      content: [{
        tag: "native_flow",
        attrs: { v: "9", name: "mixed" },
      }],
    }],
  };

  const additionalNodes = isJidGroup(jid)
    ? [bizNode]
    : [{ tag: "bot", attrs: { biz_bot: "1" } }, bizNode];

  await sock.relayMessage(jid, waMessage.message, {
    messageId: waMessage.key.id,
    additionalNodes,
  });

  logger.info({
    event: "whatsapp.native_flow.sent",
    button_count: nativeButtons.length,
    button_names: nativeButtons.map((button) => button.name),
  }, "WhatsApp native-flow message sent via relayMessage");
}

async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 10);
  const nativeButtons = clean.map((x) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.text || "").slice(0, 20),
      id: String(x.id || "").slice(0, 200),
    }),
  }));

  try {
    await sendNativeFlow(sock, jid, text, nativeButtons);
  } catch (error) {
    logger.error({
      error: error?.message || error,
      stack: error?.stack,
      event: "whatsapp.native_flow.error",
    }, "WhatsApp native-flow button send failed");
    // Keep a text fallback only for transport failure; business/action IDs are unchanged.
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n"),
    });
  }
}

async function list(sock, jid, text, rows, title = "Choose") {
  // Use quick_reply instead of single_select so category/weight/menu actions render
  // and remain clickable in WhatsApp Web as well as mobile clients.
  const clean = rows.filter(Boolean).slice(0, 10);
  const nativeButtons = clean.map((x) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.title || "").slice(0, 20),
      id: String(x.id || "").slice(0, 200),
    }),
  }));

  try {
    await sendNativeFlow(sock, jid, `${String(text || "")}\\n\\n${String(title || "Choose")}:`, nativeButtons);
  } catch (error) {
    logger.error({
      error: error?.message || error,
      stack: error?.stack,
      event: "whatsapp.native_flow.list_error",
    }, "WhatsApp native-flow list send failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n"),
    });
  }
}

`;

source = source.slice(0, start) + replacement + source.slice(end);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const required of [
  marker,
  "sendNativeFlow(sock, jid",
  "generateWAMessageFromContent",
  "messageVersion: 1",
  'name: "quick_reply"',
  'tag: "biz"',
  'biz_bot: "1"',
  'event: "whatsapp.native_flow.sent"',
]) {
  if (!finalSource.includes(required)) throw new Error(`V74 validation failed: missing ${required}`);
}

if (finalSource.includes('buttons: clean.map(x => ({ buttonId:') || finalSource.includes('buttonText: { displayText:')) {
  throw new Error("V74 validation failed: legacy button transport remains active.");
}
if (finalSource.includes('await sock.sendMessage(jid, { title: "🍬 Sweet & Snacks"')) {
  throw new Error("V74 validation failed: legacy list transport remains active.");
}
if (finalSource.includes('interactiveMessage: {')) {
  throw new Error("V74 validation failed: high-level interactiveMessage transport remains active.");
}

console.log("WhatsApp runtime V74 applied; direct protobuf native-flow relay + Web-compatible quick_reply menus + messageVersion=1 + syntax check passed.");
