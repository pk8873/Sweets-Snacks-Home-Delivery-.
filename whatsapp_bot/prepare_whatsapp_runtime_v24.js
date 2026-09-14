import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_RUNTIME_FIX_V24";
if (source.includes(marker)) process.exit(0);
function replaceRequired(pattern, replacement, name) { const next = source.replace(pattern, replacement); if (next === source) throw new Error(`V24 could not locate ${name}`); source = next; }
replaceRequired(/import makeWASocket, \{ Browsers, DisconnectReason, fetchLatestWaWebVersion \} from "@whiskeysockets\/baileys";/,'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, generateWAMessageFromContent, proto } from "@whiskeysockets/baileys";',"Baileys import");
replaceRequired(/async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}\nasync function list/,`async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  try {
    const buttons = clean.map((x) => ({ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: String(x.text || "").slice(0, 20), id: String(x.id || "").slice(0, 200) }) }));
    const message = proto.Message.InteractiveMessage.create({ body: proto.Message.InteractiveMessage.Body.create({ text: String(text || "") }), footer: proto.Message.InteractiveMessage.Footer.create({ text: "Sweet & Snacks" }), nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons, messageParamsJson: "" }) });
    const generated = generateWAMessageFromContent(jid, { interactiveMessage: message }, { userJid: sock.user?.id, timestamp: new Date() });
    await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow button relay failed");
    const fallback = clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n");
    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + fallback });
  }
}
async function list`,"buttons()");
replaceRequired(/async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}\nasync function home/,`async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return sock.sendMessage(jid, { text });
  try {
    for (let start = 0; start < clean.length; start += 3) {
      const chunk = clean.slice(start, start + 3);
      const buttons = chunk.map((x) => ({ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: String(x.title || "").slice(0, 20), id: String(x.id || "").slice(0, 200) }) }));
      const message = proto.Message.InteractiveMessage.create({ body: proto.Message.InteractiveMessage.Body.create({ text: start === 0 ? String(text || "") : "More options:" }), footer: proto.Message.InteractiveMessage.Footer.create({ text: "Sweet & Snacks" }), nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons, messageParamsJson: "" }) });
      const generated = generateWAMessageFromContent(jid, { interactiveMessage: message }, { userJid: sock.user?.id, timestamp: new Date() });
      await sock.relayMessage(jid, generated.message, { messageId: generated.key.id });
    }
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow list relay failed");
    const fallback = clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n");
    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + fallback });
  }
}
async function home`,"list()");
source = `// ${marker}\\n${source}`;
fs.writeFileSync(file, source);
execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp runtime fix V24 applied; protobuf Native Flow relay + syntax check passed.");
