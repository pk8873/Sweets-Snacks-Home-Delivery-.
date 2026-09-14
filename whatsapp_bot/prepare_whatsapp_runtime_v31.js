import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V31";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V31 already applied; nothing to do.");
  process.exit(0);
}

function replaceRequired(pattern, replacement, name) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`V31 could not locate ${name}.`);
  source = next;
}

// V29/V30 were brittle because they assumed an exact state declaration layout.
// V31 deliberately does not inspect, move, or duplicate handler state. It only
// patches the two pieces that must be stable across the V27/V28 runtime source:
// action decoding and message-event diagnostics.

const actionPattern = /const actionOf = \(m\) => \{[\s\S]*?\nconst incomingLocation/;
const actionReplacement = `const actionOf = (m) => {
  const x = unwrap(m?.message);

  const readId = (value, depth = 0) => {
    if (depth > 6 || value == null) return "";
    if (typeof value === "string") {
      const raw = value.trim();
      if (!raw) return "";
      try { return readId(JSON.parse(raw), depth + 1); } catch { return ""; }
    }
    if (typeof value !== "object") return "";

    for (const key of [
      "id", "button_id", "buttonId", "row_id", "rowId",
      "selected_id", "selectedId", "selectedButtonId", "selectedRowId",
      "selectedId"
    ]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }

    return "";
  };

  const directCandidates = [
    x.buttonsResponseMessage?.selectedButtonId,
    x.listResponseMessage?.singleSelectReply?.selectedRowId,
    x.templateButtonReplyMessage?.selectedId,
    x.hydratedTemplateButtonReplyMessage?.hydratedButtonId,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.buttonParamsJson,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.params,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.buttonParams,
    x.interactiveResponseMessage?.paramsJson,
    x.interactiveResponseMessage?.buttonParamsJson
  ];

  for (const candidate of directCandidates) {
    const id = readId(candidate);
    if (id) return id;
  }

  // Some WhatsApp clients wrap the native-flow response one level deeper.
  const native = x.interactiveResponseMessage?.nativeFlowResponseMessage;
  if (native && typeof native === "object") {
    for (const [key, value] of Object.entries(native)) {
      if (!/params|button|reply/i.test(key)) continue;
      const id = readId(value);
      if (id) return id;
    }
  }

  const visible = String(
    x.buttonsResponseMessage?.selectedDisplayText ||
    x.listResponseMessage?.title ||
    x.templateButtonReplyMessage?.selectedDisplayText ||
    x.hydratedTemplateButtonReplyMessage?.selectedDisplayText ||
    x.interactiveResponseMessage?.body?.text || ""
  ).trim().toLowerCase();

  const staticLabels = {
    "🛍 shop": "shop",
    "🛒 my cart": "cart",
    "📦 my orders": "orders",
    "❤️ favorites": "favorites",
    "🔎 search": "search",
    "📍 my address": "address",
    "🌐 language": "language",
    "☎️ help": "help",
    "🏠 home": "home",
    "🛒 cart": "cart",
    "🛍 continue shopping": "shop",
    "🛍 continue": "shop",
    "🛍 shop now": "shop",
    "💳 checkout": "checkout",
    "💵 cash on delivery": "pay_cod",
    "💳 online payment": "pay_online",
    "✅ use saved": "use_address",
    "➕ add address": "new_address",
    "📍 new address": "new_address"
  };
  return staticLabels[visible] || "";
};
const incomingLocation`;
replaceRequired(actionPattern, actionReplacement, "actionOf()");

if (!source.includes('event: "whatsapp.incoming"')) {
  replaceRequired(
    /async function handle\(sock, m\) \{\n  const jid = m\?\.key\?\.remoteJid;/,
    `async function handle(sock, m) {
  const rawMessage = unwrap(m?.message);
  logger.info({
    event: "whatsapp.incoming",
    remote_jid: m?.key?.remoteJid,
    from_me: Boolean(m?.key?.fromMe),
    message_type: Object.keys(rawMessage || {}),
    has_interactive_response: Boolean(rawMessage?.interactiveResponseMessage),
    has_buttons_response: Boolean(rawMessage?.buttonsResponseMessage),
    has_list_response: Boolean(rawMessage?.listResponseMessage),
  }, "WhatsApp incoming message");
  if (rawMessage?.interactiveResponseMessage) {
    logger.info({ interactive_response: rawMessage.interactiveResponseMessage }, "WhatsApp raw interactive response");
  }
  const jid = m?.key?.remoteJid;`,
    "handle() diagnostics"
  );
}

if (!source.includes('event: "whatsapp.parsed"')) {
  replaceRequired(
    /const text = textOf\(m\), action = actionOf\(m\), location = incomingLocation\(m\), contact = incomingContact\(m\);/,
    `const text = textOf(m), action = actionOf(m), location = incomingLocation(m), contact = incomingContact(m);
  logger.info({ event: "whatsapp.parsed", text, action }, "WhatsApp message parsed");`,
    "parsed action logging"
  );
}

if (!source.includes('event: "whatsapp.messages.upsert"')) {
  replaceRequired(
    /sock\.ev\.on\("messages\.upsert",[\s\S]*?\}\);/,
    `sock.ev.on("messages.upsert", async ({ messages, type }) => {
    logger.info({ event: "whatsapp.messages.upsert", type, count: messages?.length || 0 }, "WhatsApp messages.upsert received");
    for (const m of messages || []) {
      try {
        await handle(sock, m);
      } catch (error) {
        logger.error({ error: error?.message || error, message_key: m?.key }, "WhatsApp message handler failed");
      }
    }
  });`,
    "messages.upsert listener"
  );
}

// Never manufacture a status code when there is no disconnect error.
source = source.replace(
  "status_code: new Boom(lastDisconnect?.error)?.output?.statusCode",
  "status_code: lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null"
);

// Do not require a particular state declaration. V28 can legally declare it
// together with other variables on one line, so exact-string checks are unsafe.
if (!source.includes("const state =") || !source.includes("function handle(sock, m)")) {
  throw new Error("V31 safety check failed: expected WhatsApp handler/state structure is missing.");
}

source = `// ${marker}\n${source.replace(/\n$/, "")}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V31 applied; robust action parsing + incoming diagnostics + accurate connection status + non-brittle state validation + syntax check passed.");
