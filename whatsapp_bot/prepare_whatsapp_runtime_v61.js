import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V61";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime fix V61 already applied; syntax check passed.");
  process.exit(0);
}

function replaceBetween(startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`V61 could not locate ${label}`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

const importMatch = source.match(/import\s+makeWASocket,\s*\{([\s\S]*?)\}\s+from\s+["']@whiskeysockets\/baileys["'];/);
if (!importMatch) throw new Error("V61 could not locate Baileys import");
const imports = importMatch[1].split(",").map(x => x.trim()).filter(Boolean);
for (const name of ["proto", "generateWAMessageFromContent", "fetchLatestWaWebVersion"]) {
  if (!imports.includes(name)) imports.push(name);
}
source = source.replace(importMatch[0], `import makeWASocket, { ${imports.join(", ")} } from "@whiskeysockets/baileys";`);

replaceBetween(
  "const textOf = (m) =>",
  "const incomingLocation =",
  `const textOf = (m) => {
  const x = unwrap(m?.message);
  return String(x.conversation || x.extendedTextMessage?.text || x.imageMessage?.caption || x.videoMessage?.caption || x.documentMessage?.caption || x.buttonsResponseMessage?.selectedDisplayText || x.listResponseMessage?.title || x.interactiveResponseMessage?.body?.text || "").trim();
};
const actionOf = (m) => {
  const x = unwrap(m?.message);
  if (x.buttonsResponseMessage?.selectedButtonId) return String(x.buttonsResponseMessage.selectedButtonId);
  if (x.listResponseMessage?.singleSelectReply?.selectedRowId) return String(x.listResponseMessage.singleSelectReply.selectedRowId);
  const candidates = [x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson, x.interactiveResponseMessage?.paramsJson, x.nativeFlowResponseMessage?.paramsJson];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const p = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (p?.id) return String(p.id);
      if (p?.button_id) return String(p.button_id);
      if (p?.rowId) return String(p.rowId);
      if (p?.selectedRowId) return String(p.selectedRowId);
    } catch {}
  }
  return "";
};
`,
  "text/action parser"
);

replaceBetween(
  "async function buttons(sock, jid, text, items)",
  "async function home(sock, jid)",
  `function nativeFlowBizNode(message) {
  const name = message?.interactiveMessage?.nativeFlowMessage?.buttons?.[0]?.name;
  const attrs = { actual_actors: "2", host_storage: "2", privacy_mode_ts: String(Math.floor(Date.now() / 1000) - 77980457) };
  if (name === "review_and_pay") return { tag: "biz", attrs: { ...attrs, native_flow_name: "order_details" } };
  if (name === "payment_info") return { tag: "biz", attrs: { ...attrs, native_flow_name: "payment_info" } };
  return { tag: "biz", attrs, content: [
    { tag: "interactive", attrs: { type: "native_flow", v: "1" }, content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }] },
    { tag: "quality_control", attrs: { source_type: "third_party" } },
  ] };
}

async function relayNativeFlow(sock, jid, interactiveMessage) {
  const userJid = sock.user?.id;
  if (!userJid) throw new Error("WhatsApp bot JID is not available for Native Flow relay");
  const waMessage = generateWAMessageFromContent(jid, { interactiveMessage }, { userJid, timestamp: new Date() });
  const isGroup = String(jid || "").endsWith("@g.us");
  const botNode = { tag: "bot", attrs: { biz_bot: "1" } };
  const bizNode = nativeFlowBizNode(waMessage.message);
  const additionalNodes = isGroup ? [bizNode] : [botNode, bizNode];
  await sock.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id, additionalNodes });
  logger.info({ event: "whatsapp.native_flow.sent", private_chat: !isGroup, button_count: interactiveMessage?.nativeFlowMessage?.buttons?.length || 0, message_id: waMessage.key.id }, "WhatsApp Native Flow relayed successfully");
}

async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  if (!clean.length) return;
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.create({ text: String(text || "") }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: "Sweet & Snacks" }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons: clean.map(x => proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({ display_text: String(x.text || "").slice(0, 20), id: String(x.id || "").slice(0, 200) }),
      })),
      messageParamsJson: "{}",
      messageVersion: 1,
    }),
  });
  try { await relayNativeFlow(sock, jid, interactiveMessage); }
  catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "Native Flow button send failed");
    await sock.sendMessage(jid, { text: `${text || ""}\n\n${clean.map((x, i) => `${i + 1}. ${x.text || ""}`).join("\n")}` });
  }
}

async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return;
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.create({ text: String(text || "") }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: "Sweet & Snacks" }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons: [proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
        name: "single_select",
        buttonParamsJson: JSON.stringify({ title: String(title || "Choose").slice(0, 24), sections: [{ title: "Options", rows: clean.map(x => ({ id: String(x.id || ""), title: String(x.title || "").slice(0, 24), description: String(x.description || "").slice(0, 72), header: String(x.header || "") })) }] }),
      })],
      messageParamsJson: "{}",
      messageVersion: 1,
    }),
  });
  try { await relayNativeFlow(sock, jid, interactiveMessage); }
  catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "Native Flow list send failed");
    await sock.sendMessage(jid, { text: `${text || ""}\n\n${clean.map((x, i) => `${i + 1}. ${x.title || ""}`).join("\n")}` });
  }
}

`,
  "button/list transport"
);

replaceBetween(
  "async function connect() {",
  "http.createServer(",
  `let activeSocket = null;
let reconnectTimer = null;
let reconnectDelayMs = 3000;
let connecting = false;
function scheduleReconnect(reason, delay = reconnectDelayMs) {
  if (reconnectTimer) return;
  const wait = Math.max(1000, Math.min(Number(delay) || 3000, 30000));
  logger.warn({ reason, retry_in_ms: wait }, "WhatsApp reconnect scheduled");
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect().catch(error => logger.error({ error }, "WhatsApp reconnect failed")); }, wait);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30000);
}
async function connect() {
  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");
  if (connecting || activeSocket) return;
  connecting = true;
  try {
    const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
    let version = null;
    try {
      const latest = await fetchLatestWaWebVersion();
      version = latest?.version || null;
      logger.info({ event: "whatsapp.web.version", version: version?.join?.("."), is_latest: latest?.isLatest }, "Using current WhatsApp Web version");
    } catch (error) { logger.warn({ error: error?.message || error }, "Could not refresh WhatsApp Web version; using Baileys default"); }
    const options = { auth: auth.state, browser: Browsers.ubuntu("Sweet & Snacks"), logger, markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false };
    if (version) options.version = version;
    const sock = makeWASocket(options);
    activeSocket = sock;
    sock.ev.on("creds.update", auth.saveCreds);
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      const code = connection === "close" ? new Boom(lastDisconnect?.error)?.output?.statusCode : null;
      logger.info({ event: "whatsapp.connection.update", connection, has_qr: Boolean(qr), registered: Boolean(auth.state.creds.registered), status_code: code }, "WhatsApp connection state changed");
      if (qr) qrcode.generate(qr, { small: true });
      if (connection === "open") { reconnectDelayMs = 3000; logger.info("✅ WhatsApp bot connected."); return; }
      if (connection !== "close") return;
      if (activeSocket === sock) activeSocket = null;
      if (code === 515) return scheduleReconnect("baileys_515_restart_required", 1500);
      if (code === 401 || code === DisconnectReason.loggedOut) { logger.error({ status_code: code }, "WhatsApp session invalid/logout; credentials were NOT deleted automatically"); return; }
      scheduleReconnect(`status_${code || "unknown"}`);
    });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      logger.info({ event: "whatsapp.messages.upsert", type, count: messages?.length || 0 }, "WhatsApp messages.upsert received");
      for (const m of messages || []) {
        const rawMessage = unwrap(m?.message);
        logger.info({ event: "whatsapp.incoming", remote_jid: m?.key?.remoteJid, from_me: Boolean(m?.key?.fromMe), message_type: Object.keys(rawMessage || {}), has_interactive_response: Boolean(rawMessage?.interactiveResponseMessage), has_buttons_response: Boolean(rawMessage?.buttonsResponseMessage), has_list_response: Boolean(rawMessage?.listResponseMessage) }, "WhatsApp incoming message");
        try { await handle(sock, m); }
        catch (error) { logger.error({ error: error?.message || error, stack: error?.stack, message_key: m?.key }, "WhatsApp message handler failed"); }
      }
    });
  } finally { connecting = false; }
}

`,
  "connection lifecycle"
);

const parseLine = `const name = m.pushName || "Customer", s = state(jid, name), lower = text.toLowerCase().trim();`;
if (!source.includes(parseLine)) throw new Error("V61 could not locate handle parse boundary");
source = source.replace(parseLine, `${parseLine}\n  logger.info({ event: "whatsapp.parsed", text, action, step: s.step }, "WhatsApp message parsed");`);

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
const finalSource = fs.readFileSync(file, "utf8");
for (const required of ["WHATSAPP_RUNTIME_FIX_V61", "async function relayNativeFlow", "await sock.relayMessage(jid, waMessage.message", "additionalNodes = isGroup ? [bizNode] : [botNode, bizNode]", "messageVersion: 1", "shouldSyncHistoryMessage: () => false"]) {
  if (!finalSource.includes(required)) throw new Error(`V61 validation failed: missing ${required}`);
}
if (finalSource.includes('sock.sendMessage(jid, { text, footer: "Sweet & Snacks", buttons:')) throw new Error("V61 validation failed: legacy button sender is still active");
console.log("WhatsApp runtime fix V61 applied; consolidated Native Flow relay + parser + connection lifecycle + syntax validation passed.");
