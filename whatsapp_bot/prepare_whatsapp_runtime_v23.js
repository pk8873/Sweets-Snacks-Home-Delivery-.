import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_RUNTIME_FIX_V23";

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V23 already applied.");
  process.exit(0);
}

function replaceRequired(pattern, replacement, name) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`V23 could not locate ${name}`);
  source = next;
}

replaceRequired(
  /async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}\nasync function list/,
  `async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  const nativeButtons = clean.map((x) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.text || "").slice(0, 20),
      id: String(x.id || "").slice(0, 200),
    }),
  }));
  try {
    await sock.sendMessage(jid, {
      interactiveMessage: {
        body: { text: String(text || "") },
        footer: { text: "Sweet & Snacks" },
        nativeFlowMessage: { buttons: nativeButtons, messageParamsJson: "" },
      },
    });
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow button send failed");
    const fallback = clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n");
    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + fallback });
  }
}
async function list`,
  "buttons()"
);

replaceRequired(
  /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}\nasync function home/,
  `async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return sock.sendMessage(jid, { text });
  try {
    for (let start = 0; start < clean.length; start += 3) {
      const chunk = clean.slice(start, start + 3);
      const nativeButtons = chunk.map((x) => ({
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: String(x.title || "").slice(0, 20),
          id: String(x.id || "").slice(0, 200),
        }),
      }));
      await sock.sendMessage(jid, {
        interactiveMessage: {
          body: { text: start === 0 ? String(text || "") : "More options:" },
          footer: { text: "Sweet & Snacks" },
          nativeFlowMessage: { buttons: nativeButtons, messageParamsJson: "" },
        },
      });
    }
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow list send failed");
    const fallback = clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n");
    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + fallback });
  }
}
async function home`,
  "list()"
);

// Install one listener that logs the complete upsert envelope before dispatch.
const listenerPattern = /sock\.ev\.on\("messages\.upsert",[\s\S]*?\}\);/;
if (listenerPattern.test(source)) {
  source = source.replace(listenerPattern, `sock.ev.on("messages.upsert", async ({ messages, type }) => {
  logger.info({ event: "whatsapp.messages.upsert", type, count: messages?.length || 0 }, "WhatsApp messages.upsert received");
  for (const m of messages || []) {
    try {
      await handle(sock, m);
    } catch (error) {
      logger.error({ error: error?.message || error, message_key: m?.key }, "WhatsApp message handler failed");
    }
  }
});`);
}

// Log connection transitions so a 515/reconnect cannot leave an apparently live but unusable bot.
const connectionMarker = "WHATSAPP_CONNECTION_DIAGNOSTICS_V23";
if (!source.includes(connectionMarker)) {
  const connectionTrigger = '  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {';
  if (source.includes(connectionTrigger)) {
    source = source.replace(connectionTrigger, `  // ${connectionMarker}
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    logger.info({ event: "whatsapp.connection.update", connection, has_qr: Boolean(qr), registered: Boolean(auth.state.creds.registered), status_code: new Boom(lastDisconnect?.error)?.output?.statusCode }, "WhatsApp connection state changed");`);
  }
}

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source);
execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp runtime fix V23 applied; explicit Native Flow + response diagnostics + connection diagnostics + syntax check passed.");
