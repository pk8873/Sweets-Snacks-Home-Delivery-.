import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V85";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V85 already applied; syntax check passed.");
  process.exit(0);
}

const replaceOnce = (from, to, label) => {
  if (!source.includes(from)) throw new Error(`V85 could not locate ${label}`);
  source = source.replace(from, to);
};

if (!source.includes('import fs from "node:fs";')) {
  replaceOnce('import "dotenv/config";', 'import "dotenv/config";\nimport fs from "node:fs";', "fs import anchor");
}

if (!source.includes('import baileysHelper from "zqbaileys_helper";')) {
  replaceOnce('import "dotenv/config";', 'import "dotenv/config";\nimport baileysHelper from "zqbaileys_helper";\nconst { sendInteractiveMessage } = baileysHelper;', "helper import anchor");
}

if (!source.includes("saveAddress")) {
  replaceOnce('setLanguage } from "./api.js";', 'setLanguage, saveAddress } from "./api.js";', "saveAddress import");
}

const oldAction = 'const actionOf = (m) => { const x = unwrap(m?.message); if (x.buttonsResponseMessage?.selectedButtonId) return x.buttonsResponseMessage.selectedButtonId; if (x.listResponseMessage?.singleSelectReply?.selectedRowId) return x.listResponseMessage.singleSelectReply.selectedRowId; const raw = x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson; if (raw) { try { return JSON.parse(raw)?.id || ""; } catch {} } return ""; };';
const newAction = [
  'const actionOf = (m) => {',
  '  const x = unwrap(m?.message);',
  '  if (x.buttonsResponseMessage?.selectedButtonId) return String(x.buttonsResponseMessage.selectedButtonId);',
  '  if (x.listResponseMessage?.singleSelectReply?.selectedRowId) return String(x.listResponseMessage.singleSelectReply.selectedRowId);',
  '  const raws = [x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson, x.interactiveResponseMessage?.paramsJson, x.nativeFlowResponseMessage?.paramsJson];',
  '  for (const raw of raws) {',
  '    if (!raw) continue;',
  '    try {',
  '      const p = typeof raw === "string" ? JSON.parse(raw) : raw;',
  '      if (p?.id) return String(p.id);',
  '      if (p?.button_id) return String(p.button_id);',
  '      if (p?.rowId) return String(p.rowId);',
  '      if (p?.selectedRowId) return String(p.selectedRowId);',
  '    } catch {}',
  '  }',
  '  return "";',
  '};'
].join("\n");
replaceOnce(oldAction, newAction, "action parser");

const transportStart = source.indexOf("async function buttons(sock, jid, text, items)");
const transportEnd = source.indexOf("async function home(sock, jid)", transportStart);
if (transportStart < 0 || transportEnd <= transportStart) throw new Error("V85 could not locate button/list transport");

const transport = [
  "async function buttons(sock, jid, text, items) {",
  "  const clean = (items || []).filter(Boolean).slice(0, 3);",
  "  if (!clean.length) return;",
  "  const interactiveButtons = clean.map((x) => ({",
  '    name: "quick_reply",',
  "    buttonParamsJson: JSON.stringify({",
  '      display_text: String(x.text || "").slice(0, 20),',
  '      id: String(x.id || "").slice(0, 200)',
  "    })",
  "  }));",
  "  try {",
  "    await sendInteractiveMessage(sock, jid, {",
  '      text: String(text || ""),',
  '      footer: "Sweet & Snacks",',
  "      interactiveButtons",
  "    }, { mdPatch: true });",
  '    logger.info({ event: "whatsapp.native_flow.sent", kind: "quick_reply", button_count: interactiveButtons.length }, "WhatsApp interactive buttons sent");',
  "  } catch (error) {",
  '    logger.error({ event: "whatsapp.native_flow.error", error: error?.message || error, stack: error?.stack }, "WhatsApp interactive button send failed");',
  '    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n") }).catch(() => {});',
  "  }",
  "}",
  "",
  'async function list(sock, jid, text, rows, title = "Choose") {',
  "  const clean = (rows || []).filter(Boolean).slice(0, 10);",
  "  if (!clean.length) return;",
  "  const interactiveButtons = [{",
  '    name: "single_select",',
  "    buttonParamsJson: JSON.stringify({",
  '      title: String(title || "Choose").slice(0, 24),',
  '      sections: [{ title: "Options", rows: clean.map((x) => ({ id: String(x.id || "").slice(0, 200), title: String(x.title || "").slice(0, 24), description: String(x.description || "").slice(0, 72) })) }]',
  "    })",
  "  }];",
  "  try {",
  '    await sendInteractiveMessage(sock, jid, { text: String(text || ""), footer: "Sweet & Snacks", interactiveButtons }, { mdPatch: true });',
  '    logger.info({ event: "whatsapp.native_flow.sent", kind: "single_select", row_count: clean.length }, "WhatsApp interactive list sent");',
  "  } catch (error) {",
  '    logger.error({ event: "whatsapp.native_flow.list_error", error: error?.message || error, stack: error?.stack }, "WhatsApp interactive list send failed");',
  '    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n") }).catch(() => {});',
  "  }",
  "}",
  ""
].join("\n");
source = source.slice(0, transportStart) + transport + source.slice(transportEnd);

const oldWeight = 'if (action.startsWith("weight_")) { const parts = action.split("_"); s.weight = Number(parts[2]); const r = await getProduct(Number(parts[1])); return product(sock, jid, r.product); }';
const newWeight = [
  'if (action.startsWith("weight_")) {',
  '  const parts = action.split("_");',
  '  s.weight = Number(parts[2]);',
  '  const r = await getProduct(Number(parts[1]));',
  '  s.product = r.product;',
  '  s.step = "product";',
  '  const p = r.product;',
  '  const base = "🍬 *" + p.name + "*\\n\\n" + (p.description || "Freshly prepared and carefully packed.") + "\\n\\n💰 " + money(p.price) + " / " + p.price_quantity_label + "\\n📦 " + p.stock_display + "\\n⚖️ Weight: *" + labelWeight(s.weight) + "*";',
  '  return productActions(sock, jid, p, base);',
  '}'
].join("\n");
replaceOnce(oldWeight, newWeight, "weight-selection handler");

const oldNewAddress = 'if (action === "new_address") return addresses(sock, jid);';
const newNewAddress = [
  'if (action === "new_address") {',
  '  s.step = "address_input";',
  '  s.waiting = true;',
  '  return buttons(sock, jid, "📍 *NEW DELIVERY ADDRESS*\\n\\nSend your address in this format:\\nHouse/Street, City, 6-digit Pincode", [{ id: "address", text: "📍 My Address" }, { id: "home", text: "🏠 Home" }]);',
  '}'
].join("\n");
replaceOnce(oldNewAddress, newNewAddress, "new-address action");

const addressAnchor = 'if (action === "use_address") return payment(sock, jid);';
const addressHandler = [
  'if (s.step === "address_input" && s.waiting && text) {',
  '  const parts = text.split(",").map(v => v.trim()).filter(Boolean);',
  '  if (parts.length < 3) return buttons(sock, jid, "⚠️ Please send: House/Street, City, 6-digit Pincode", [{ id: "home", text: "🏠 Home" }]);',
  '  const pincode = parts[parts.length - 1];',
  '  const city = parts[parts.length - 2];',
  '  const address = parts.slice(0, -2).join(", ");',
  '  if (!/^\\d{6}$/.test(pincode) || !address || !city) return buttons(sock, jid, "⚠️ Invalid address format. Please send: House/Street, City, 6-digit Pincode", [{ id: "home", text: "🏠 Home" }]);',
  '  await saveAddress({ ...payload(jid, name), address, city, pincode });',
  '  s.waiting = false;',
  '  s.step = "address_choice";',
  '  return addresses(sock, jid);',
  '}',
  ''
].join("\n");
replaceOnce(addressAnchor, addressHandler + addressAnchor, "address input handler");

const connectStart = source.indexOf("async function connect() {");
const httpStart = source.indexOf("http.createServer(", connectStart);
if (connectStart < 0 || httpStart <= connectStart) throw new Error("V85 could not locate connect() block");

const connectBlock = [
  "async function connect() {",
  '  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render.");',
  '  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");',
  '  const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || process.env.WHATSAPP_PAIRING_NUMBER || "").replace(/\\D/g, "");',
  '  if (!auth.state.creds.registered && !pairingNumber) throw new Error("WHATSAPP_PHONE_NUMBER is required for first-time WhatsApp pairing.");',
  '  if (pairingNumber && (pairingNumber.length < 10 || pairingNumber.length > 15)) throw new Error("WHATSAPP_PHONE_NUMBER must contain 10-15 digits with country code, without + or spaces.");',
  "",
  "  const latest = await fetchLatestWaWebVersion({});",
  "  const version = latest?.version;",
  '  logger.info({ wa_web_version: version?.join("."), is_latest: latest?.isLatest }, "Using current WhatsApp Web version");',
  "  const sock = makeWASocket({",
  "    auth: auth.state,",
  '    ...(version ? { version } : {}),',
  '    browser: Browsers.windows("Chrome"),',
  '    companionPlatformDisplay: "Chrome (Windows)",',
  '    countryCode: "IN",',
  "    logger,",
  "    markOnlineOnConnect: false,",
  "    syncFullHistory: false,",
  "    shouldSyncHistoryMessage: () => false,",
  "    connectTimeoutMs: 60000,",
  "    keepAliveIntervalMs: 20000",
  "  });",
  '  sock.ev.on("creds.update", auth.saveCreds);',
  "",
  "  let closed = false;",
  "  let reconnectTimer = null;",
  "  let reconnectDelay = 2000;",
  "  let pairingRequested = false;",
  "  let pairingAttempts = 0;",
  "  const scheduleReconnect = (reason, delay = reconnectDelay) => {",
  "    if (reconnectTimer || !closed) return;",
  "    const retry = Math.max(1000, delay);",
  "    reconnectTimer = setTimeout(() => {",
  "      reconnectTimer = null;",
  '      connect().catch(error => logger.error({ error: error?.message || error }, "WhatsApp reconnect failed"));',
  "    }, retry);",
  "    reconnectDelay = Math.min(reconnectDelay * 2, 30000);",
  '    logger.warn({ reason, retry_in_ms: retry }, "WhatsApp reconnect scheduled");',
  "  };",
  "  const requestPairingCode = async () => {",
  "    if (pairingRequested || closed || auth.state.creds.registered || !pairingNumber) return;",
  "    pairingRequested = true;",
  "    pairingAttempts += 1;",
  "    try {",
  "      await new Promise(resolve => setTimeout(resolve, 1500));",
  "      if (closed || auth.state.creds.registered) { pairingRequested = false; return; }",
  "      const code = await sock.requestPairingCode(pairingNumber);",
  '      const formatted = String(code).match(/.{1,4}/g)?.join("-") || String(code);',
  '      logger.info({ pairing_code: formatted, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4), companion_platform_display: "Chrome (Windows)" }, "WHATSAPP PAIRING CODE READY — enter this code in WhatsApp > Linked Devices > Link with phone number");',
  "    } catch (error) {",
  "      pairingRequested = false;",
  '      logger.error({ error: error?.message || error, pairing_attempt: pairingAttempts }, "WhatsApp pairing code request failed; retrying");',
  '      if (!closed) setTimeout(() => requestPairingCode().catch(() => {}), 3000);',
  "    }",
  "  };",
  "",
  '  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {',
  '    const code = connection === "close" ? new Boom(lastDisconnect?.error)?.output?.statusCode : null;',
  '    logger.info({ event: "whatsapp.connection.update", connection, has_qr: Boolean(qr), registered: Boolean(auth.state.creds.registered), status_code: code }, "WhatsApp connection state changed");',
  '    if (!auth.state.creds.registered && pairingNumber && (connection === "connecting" || qr)) await requestPairingCode();',
  '    if (connection === "open") { closed = false; reconnectDelay = 2000; pairingRequested = false; logger.info("WhatsApp bot connected."); return; }',
  '    if (connection !== "close") return;',
  "    closed = true;",
  '    logger.error({ status_code: code, registered: Boolean(auth.state.creds.registered), last_disconnect: lastDisconnect?.error?.message || null }, "WhatsApp connection closed");',
  '    if (code === DisconnectReason.loggedOut) { await auth.deleteSession(); logger.error("WhatsApp logged out. Stored session was cleared; supervisor will restart for a new pairing code."); return; }',
  '    if (code === DisconnectReason.badSession && !auth.state.creds.registered) { await auth.deleteSession(); scheduleReconnect("pending_pairing_bad_session_401", 2000); return; }',
  '    if (code === DisconnectReason.restartRequired) { scheduleReconnect("restart_required_515", 2000); return; }',
  '    scheduleReconnect("disconnect_" + (code || "unknown"));',
  "  });",
  "",
  '  sock.ev.on("messages.upsert", async ({ messages, type }) => {',
  '    logger.info({ event: "whatsapp.messages.upsert", type, count: messages?.length || 0 }, "WhatsApp messages.upsert received");',
  "    for (const m of messages || []) {",
  "      const rawMessage = unwrap(m?.message);",
  '      logger.info({ event: "whatsapp.incoming", remote_jid: m?.key?.remoteJid, from_me: Boolean(m?.key?.fromMe), message_type: Object.keys(rawMessage || {}), has_interactive_response: Boolean(rawMessage?.interactiveResponseMessage), has_buttons_response: Boolean(rawMessage?.buttonsResponseMessage), has_list_response: Boolean(rawMessage?.listResponseMessage) }, "WhatsApp incoming message");',
  "      try {",
  "        await handle(sock, m);",
  "      } catch (error) {",
  '        logger.error({ error: error?.message || error, stack: error?.stack, message_key: m?.key }, "WhatsApp message handler failed");',
  "      }",
  "    }",
  "  });",
  "}",
  ""
].join("\n");
source = source.slice(0, connectStart) + connectBlock + source.slice(httpStart);

source = "// " + marker + "\n" + source;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
const required = [marker, 'import baileysHelper from "zqbaileys_helper";', "sendInteractiveMessage(sock, jid", 'name: "quick_reply"', 'name: "single_select"', "WHATSAPP PAIRING CODE READY", "WhatsApp messages.upsert received", "saveAddress", "address_input"];
for (const item of required) if (!finalSource.includes(item)) throw new Error("V85 validation failed: missing " + item);

const startCheck = finalSource.indexOf("async function buttons(sock, jid, text, items)");
const endCheck = finalSource.indexOf("async function home(sock, jid)", startCheck);
const active = finalSource.slice(startCheck, endCheck);
for (const forbidden of ["buttons: clean.map(x => ({ buttonId:", "buttonText: { displayText:", "interactiveMessage: {", 'await sock.sendMessage(jid, { title: "🍬 Sweet & Snacks"']) {
  if (active.includes(forbidden)) throw new Error("V85 validation failed: legacy interactive transport remains: " + forbidden);
}

const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") throw new Error("V85 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");

console.log("WhatsApp runtime V85 applied; helper Native Flow transport + pairing/reconnect + response diagnostics + address/weight fixes + syntax validation passed.");
