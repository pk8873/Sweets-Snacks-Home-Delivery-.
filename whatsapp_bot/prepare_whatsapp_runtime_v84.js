import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V84";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V84 already applied; syntax check passed.");
  process.exit(0);
}

const mustReplace = (from, to, label) => {
  if (!source.includes(from)) throw new Error(`V84 could not locate ${label}`);
  source = source.replace(from, to);
};

// 1) Use the helper's low-level relay. Normal Baileys sendMessage rejects
// interactiveMessage as an invalid media type on this pinned Baileys build.
const helperImport = 'import baileysHelper from "zqbaileys_helper";\nconst { sendInteractiveMessage } = baileysHelper;';
if (!source.includes('import baileysHelper from "zqbaileys_helper";')) {
  mustReplace('import "dotenv/config";', `import "dotenv/config";\n${helperImport}`, "helper import anchor");
}

// saveAddress is already implemented in api.js; wire it into the existing bot.
if (!source.includes("saveAddress")) {
  mustReplace(
    'setLanguage } from "./api.js";',
    'setLanguage, saveAddress } from "./api.js";',
    "saveAddress API import"
  );
}

// 2) Make interactive response parsing tolerant of the response shapes seen
// across WhatsApp/Baileys versions while preserving every existing action id.
const oldAction = 'const actionOf = (m) => { const x = unwrap(m?.message); if (x.buttonsResponseMessage?.selectedButtonId) return x.buttonsResponseMessage.selectedButtonId; if (x.listResponseMessage?.singleSelectReply?.selectedRowId) return x.listResponseMessage.singleSelectReply.selectedRowId; const raw = x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson; if (raw) { try { return JSON.parse(raw)?.id || ""; } catch {} } return ""; };';
const newAction = `const actionOf = (m) => {\n  const x = unwrap(m?.message);\n  if (x.buttonsResponseMessage?.selectedButtonId) return String(x.buttonsResponseMessage.selectedButtonId);\n  if (x.listResponseMessage?.singleSelectReply?.selectedRowId) return String(x.listResponseMessage.singleSelectReply.selectedRowId);\n  for (const raw of [x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson, x.interactiveResponseMessage?.paramsJson, x.nativeFlowResponseMessage?.paramsJson]) {\n    if (!raw) continue;\n    try {\n      const p = typeof raw === "string" ? JSON.parse(raw) : raw;\n      if (p?.id) return String(p.id);\n      if (p?.button_id) return String(p.button_id);\n      if (p?.rowId) return String(p.rowId);\n      if (p?.selectedRowId) return String(p.selectedRowId);\n    } catch {}\n  }\n  return "";\n};`;
mustReplace(oldAction, newAction, "action parser");

// 3) Replace only the button/list transport. Business handlers and action IDs
// remain unchanged.
const transportStart = source.indexOf("async function buttons(sock, jid, text, items)");
const transportEnd = source.indexOf("async function home(sock, jid)", transportStart);
if (transportStart < 0 || transportEnd <= transportStart) throw new Error("V84 could not locate button/list transport block");

const transport = `async function buttons(sock, jid, text, items) {\n  const clean = (items || []).filter(Boolean).slice(0, 3);\n  if (!clean.length) return;\n  const interactiveButtons = clean.map((x) => ({\n    name: "quick_reply",\n    buttonParamsJson: JSON.stringify({\n      display_text: String(x.text || "").slice(0, 20),\n      id: String(x.id || "").slice(0, 200),\n    }),\n  }));\n  try {\n    await sendInteractiveMessage(sock, jid, {\n      text: String(text || ""),\n      footer: "Sweet & Snacks",\n      interactiveButtons,\n    }, { mdPatch: true });\n    logger.info({ event: "whatsapp.native_flow.sent", kind: "quick_reply", button_count: interactiveButtons.length }, "WhatsApp interactive buttons sent");\n  } catch (error) {\n    logger.error({ event: "whatsapp.native_flow.error", error: error?.message || error, stack: error?.stack }, "WhatsApp interactive button send failed");\n    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n") });\n  }\n}\n\nasync function list(sock, jid, text, rows, title = "Choose") {\n  const clean = (rows || []).filter(Boolean).slice(0, 10);\n  if (!clean.length) return;\n  const interactiveButtons = [{\n    name: "single_select",\n    buttonParamsJson: JSON.stringify({\n      title: String(title || "Choose").slice(0, 24),\n      sections: [{ title: "Options", rows: clean.map((x) => ({ id: String(x.id || "").slice(0, 200), title: String(x.title || "").slice(0, 24), description: String(x.description || "").slice(0, 72) })) }],\n    }),\n  }];\n  try {\n    await sendInteractiveMessage(sock, jid, { text: String(text || ""), footer: "Sweet & Snacks", interactiveButtons }, { mdPatch: true });\n    logger.info({ event: "whatsapp.native_flow.sent", kind: "single_select", row_count: clean.length }, "WhatsApp interactive list sent");\n  } catch (error) {\n    logger.error({ event: "whatsapp.native_flow.list_error", error: error?.message || error, stack: error?.stack }, "WhatsApp interactive list send failed");\n    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n") });\n  }\n}\n`;
source = source.slice(0, transportStart) + transport + source.slice(transportEnd);

// 4) Fix the previously dead weight-selection flow: after selecting a weight,
// continue to quantity/add-to-cart instead of showing the same weight menu.
const oldWeight = 'if (action.startsWith("weight_")) { const parts = action.split("_"); s.weight = Number(parts[2]); const r = await getProduct(Number(parts[1])); return product(sock, jid, r.product); }';
const newWeight = 'if (action.startsWith("weight_")) { const parts = action.split("_"); s.weight = Number(parts[2]); const r = await getProduct(Number(parts[1])); s.product = r.product; s.step = "product"; const p = r.product; const base = `🍬 *${p.name}*\\n\\n${p.description || "Freshly prepared and carefully packed."}\\n\\n💰 ${money(p.price)} / ${p.price_quantity_label}\\n📦 ${p.stock_display}\\n⚖️ Weight: *${labelWeight(s.weight)}*`; return productActions(sock, jid, p, base); }';
mustReplace(oldWeight, newWeight, "weight-selection handler");

// The quantity-display button is intentionally non-mutating; clicking it simply
// redraws the current product controls instead of falling into the generic error.
const qtyAnchor = 'if (action.startsWith("qtyinc_"))';
if (!source.includes('if (/^qty_\\d+$/.test(action))')) {
  mustReplace(qtyAnchor, 'if (/^qty_\\d+$/.test(action)) { if (!s.product) return home(sock, jid); const p = s.product; const base = `🍬 *${p.name}*\\n\\n${p.description || "Freshly prepared and carefully packed."}\\n\\n💰 ${money(p.price)} / ${p.price_quantity_label}\\n📦 ${p.stock_display}`; return productActions(sock, jid, p, base); }\n    ' + qtyAnchor, "quantity display handler");
}

// 5) Fix the address loop. "Add/Change Address" now asks for one line in the
// form: full address, city, pincode. The existing Django saveAddress API is used.
const oldNewAddress = 'if (action === "new_address") return addresses(sock, jid);';
const newNewAddress = 'if (action === "new_address") { s.step = "address_input"; s.waiting = true; return buttons(sock, jid, "📍 *NEW DELIVERY ADDRESS*\\n\\nSend your address in this format:\\nHouse/Street, City, 6-digit Pincode", [{ id: "address", text: "📍 My Address" }, { id: "home", text: "🏠 Home" }]); }';
mustReplace(oldNewAddress, newNewAddress, "new-address action");
const addressAnchor = 'if (action === "use_address") return payment(sock, jid);';
const addressHandler = `if (s.step === "address_input" && s.waiting && text) {\n      const parts = text.split(",").map(v => v.trim()).filter(Boolean);\n      if (parts.length < 3) return buttons(sock, jid, "⚠️ Please send: House/Street, City, 6-digit Pincode", [{ id: "home", text: "🏠 Home" }]);\n      const pincode = parts[parts.length - 1];\n      const city = parts[parts.length - 2];\n      const address = parts.slice(0, -2).join(", ");\n      if (!/^\\d{6}$/.test(pincode) || !address || !city) return buttons(sock, jid, "⚠️ Invalid address format. Please send: House/Street, City, 6-digit Pincode", [{ id: "home", text: "🏠 Home" }]);\n      await saveAddress({ ...payload(jid, name), address, city, pincode });\n      s.waiting = false;\n      s.step = "address_choice";\n      return addresses(sock, jid);\n    }\n    `;
mustReplace(addressAnchor, addressHandler + addressAnchor, "address input handler");

// 6) Replace the brittle connect lifecycle with one consolidated, production-safe
// pairing/reconnect/message listener. No QR is displayed; phone pairing code is used.
const connectStart = source.indexOf("async function connect() {");
const httpStart = source.indexOf("http.createServer(", connectStart);
if (connectStart < 0 || httpStart <= connectStart) throw new Error("V84 could not locate connect() block");
const connectBlock = `async function connect() {\n  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render.");\n  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");\n  const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || process.env.WHATSAPP_PAIRING_NUMBER || "").replace(/\\D/g, "");\n  if (!auth.state.creds.registered && !pairingNumber) throw new Error("WHATSAPP_PHONE_NUMBER is required for first-time WhatsApp pairing.");\n  if (pairingNumber && (pairingNumber.length < 10 || pairingNumber.length > 15)) throw new Error("WHATSAPP_PHONE_NUMBER must contain 10-15 digits with country code, without + or spaces.");\n\n  if (/^(1|true|yes)$/i.test(String(process.env.WHATSAPP_NEW_PAIRING || "").trim()) && !fs.existsSync("/tmp/sweet-snacks-whatsapp-new-pairing")) {\n    if (auth.state.creds.registered) {\n      await auth.deleteSession();\n      fs.writeFileSync("/tmp/sweet-snacks-whatsapp-new-pairing", String(Date.now()), "utf8");\n      logger.warn("WHATSAPP_NEW_PAIRING cleared the stored session once. Remove the variable after successful pairing.");\n      process.exit(0);\n    }\n  }\n\n  const latest = await fetchLatestWaWebVersion({});\n  const version = latest?.version;\n  logger.info({ wa_web_version: version?.join?.("."), is_latest: latest?.isLatest }, "Using current WhatsApp Web version");\n  const sock = makeWASocket({ auth: auth.state, ...(version ? { version } : {}), browser: Browsers.windows("Chrome"), companionPlatformDisplay: "Chrome (Windows)", countryCode: "IN", logger, markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false, connectTimeoutMs: 60000, keepAliveIntervalMs: 20000 });\n  sock.ev.on("creds.update", auth.saveCreds);\n\n  let closed = false;\n  let reconnectTimer = null;\n  let reconnectDelay = 2000;\n  let pairingRequested = false;\n  let pairingAttempts = 0;\n  const scheduleReconnect = (reason, delay = reconnectDelay) => {\n    if (reconnectTimer || !closed) return;\n    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect().catch(error => logger.error({ error: error?.message || error }, "WhatsApp reconnect failed")); }, Math.max(1000, delay));\n    reconnectDelay = Math.min(reconnectDelay * 2, 30000);\n    logger.warn({ reason, retry_in_ms: Math.max(1000, delay) }, "WhatsApp reconnect scheduled");\n  };\n  const requestPairingCode = async () => {\n    if (pairingRequested || closed || auth.state.creds.registered || !pairingNumber) return;\n    pairingRequested = true; pairingAttempts += 1;\n    try {\n      await new Promise(resolve => setTimeout(resolve, 1500));\n      if (closed || auth.state.creds.registered) { pairingRequested = false; return; }\n      const code = await sock.requestPairingCode(pairingNumber);\n      const formatted = String(code).match(/.{1,4}/g)?.join("-") || String(code);\n      logger.info({ pairing_code: formatted, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4), companion_platform_display: "Chrome (Windows)" }, "WHATSAPP PAIRING CODE READY — enter this code in WhatsApp > Linked Devices > Link with phone number");\n    } catch (error) {\n      pairingRequested = false;\n      logger.error({ error: error?.message || error, pairing_attempt: pairingAttempts }, "WhatsApp pairing code request failed; retrying");\n      if (!closed) setTimeout(() => requestPairingCode().catch(() => {}), 3000);\n    }\n  };\n\n  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {\n    const code = connection === "close" ? new Boom(lastDisconnect?.error)?.output?.statusCode : null;\n    logger.info({ event: "whatsapp.connection.update", connection, has_qr: Boolean(qr), registered: Boolean(auth.state.creds.registered), status_code: code }, "WhatsApp connection state changed");\n    if (!auth.state.creds.registered && pairingNumber && (connection === "connecting" || qr)) await requestPairingCode();\n    if (connection === "open") { closed = false; reconnectDelay = 2000; pairingRequested = false; logger.info("✅ WhatsApp bot connected."); return; }\n    if (connection !== "close") return;\n    closed = true;\n    logger.error({ status_code: code, registered: Boolean(auth.state.creds.registered), last_disconnect: lastDisconnect?.error?.message || null }, "WhatsApp connection closed");\n    if (code === DisconnectReason.loggedOut) { await auth.deleteSession(); logger.error("WhatsApp logged out. Stored session was cleared; supervisor will restart for a new pairing code."); return; }\n    if (code === DisconnectReason.badSession && !auth.state.creds.registered) { await auth.deleteSession(); scheduleReconnect("pending_pairing_bad_session_401", 2000); return; }\n    if (code === DisconnectReason.restartRequired) { scheduleReconnect("restart_required_515", 2000); return; }\n    scheduleReconnect(`disconnect_${code || "unknown"}`);\n  });\n\n  sock.ev.on("messages.upsert", async ({ messages, type }) => {\n    logger.info({ event: "whatsapp.messages.upsert", type, count: messages?.length || 0 }, "WhatsApp messages.upsert received");\n    for (const m of messages || []) {\n      const rawMessage = unwrap(m?.message);\n      logger.info({ event: "whatsapp.incoming", remote_jid: m?.key?.remoteJid, from_me: Boolean(m?.key?.fromMe), message_type: Object.keys(rawMessage || {}), has_interactive_response: Boolean(rawMessage?.interactiveResponseMessage), has_buttons_response: Boolean(rawMessage?.buttonsResponseMessage), has_list_response: Boolean(rawMessage?.listResponseMessage) }, "WhatsApp incoming message");\n      try { await handle(sock, m); } catch (error) { logger.error({ error: error?.message || error, stack: error?.stack, message_key: m?.key }, "WhatsApp message handler failed"); }\n    }\n  });\n}\n\n`;
source = source.slice(0, connectStart) + connectBlock + source.slice(httpStart);

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
const required = [marker, 'import baileysHelper from "zqbaileys_helper";', "sendInteractiveMessage(sock, jid", "name: \"quick_reply\"", "name: \"single_select\"", "WHATSAPP PAIRING CODE READY", "WhatsApp messages.upsert received", "saveAddress", "address_input"];
for (const item of required) if (!finalSource.includes(item)) throw new Error(`V84 validation failed: missing ${item}`);

const startCheck = finalSource.indexOf("async function buttons(sock, jid, text, items)");
const endCheck = finalSource.indexOf("async function home(sock, jid)", startCheck);
const active = finalSource.slice(startCheck, endCheck);
for (const forbidden of ["buttons: clean.map(x => ({ buttonId:", "buttonText: { displayText:", "interactiveMessage: {", "await sock.sendMessage(jid, { title: \"🍬 Sweet & Snacks\""])
  if (active.includes(forbidden)) throw new Error(`V84 validation failed: legacy interactive transport remains: ${forbidden}`);

const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") throw new Error("V84 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");

console.log("WhatsApp runtime V84 applied; helper Native Flow transport + pairing lifecycle + response diagnostics + address/weight flow fixes + syntax validation passed.");
