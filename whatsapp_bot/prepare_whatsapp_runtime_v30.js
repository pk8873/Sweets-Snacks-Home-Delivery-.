import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_RUNTIME_FIX_V30";

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V30 already applied; nothing to do.");
  process.exit(0);
}

function replaceRequired(pattern, replacement, name) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`V30 could not locate ${name}.`);
  source = next;
}

// V29 attempted to infer the handler's state declaration from a later branch.
// V28 intentionally keeps the single handler state declaration near the top of handle().
// V30 therefore does not move or duplicate state; it makes response parsing observable,
// keeps the state safety check, and fixes misleading connection diagnostics.

replaceRequired(
  /const actionOf = \(m\) => \{[\s\S]*?\nconst incomingLocation/,
  `const actionOf = (m) => {
  const x = unwrap(m?.message);
  const findId = (value) => {
    if (!value) return "";
    if (typeof value === "string") {
      try { return findId(JSON.parse(value)); } catch { return value.trim(); }
    }
    if (typeof value !== "object") return "";
    for (const key of [
      "id", "button_id", "row_id", "selected_id",
      "selectedButtonId", "selectedRowId", "selectedId"
    ]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
    for (const child of Object.values(value)) {
      const found = findId(child);
      if (found) return found;
    }
    return "";
  };

  const candidates = [
    x.buttonsResponseMessage?.selectedButtonId,
    x.listResponseMessage?.singleSelectReply?.selectedRowId,
    x.templateButtonReplyMessage?.selectedId,
    x.hydratedTemplateButtonReplyMessage?.hydratedButtonId,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.buttonParamsJson,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.params,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.buttonParams,
    x.interactiveResponseMessage?.paramsJson,
  ];

  for (const candidate of candidates) {
    const id = findId(candidate);
    if (id) return id;
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
    "💳 checkout": "checkout",
    "💵 cash on delivery": "pay_cod",
    "💳 online payment": "pay_online",
  };
  return staticLabels[visible] || "";
};
const incomingLocation`,
  "actionOf()"
);

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

const listenerPattern = /sock\.ev\.on\("messages\.upsert",[\s\S]*?\}\);/;
if (!source.includes('event: "whatsapp.messages.upsert"')) {
  const listenerReplacement = `sock.ev.on("messages.upsert", async ({ messages, type }) => {
    logger.info({ event: "whatsapp.messages.upsert", type, count: messages?.length || 0 }, "WhatsApp messages.upsert received");
    for (const m of messages || []) {
      try {
        await handle(sock, m);
      } catch (error) {
        logger.error({ error: error?.message || error, message_key: m?.key }, "WhatsApp message handler failed");
      }
    }
  });`;
  replaceRequired(listenerPattern, listenerReplacement, "messages.upsert listener");
}

// V23's logger created Boom(undefined), which reports the default 500 and makes a
// healthy connection look like an error. Only report a status when an actual error exists.
if (source.includes("status_code: new Boom(lastDisconnect?.error)?.output?.statusCode")) {
  source = source.replace(
    "status_code: new Boom(lastDisconnect?.error)?.output?.statusCode",
    "status_code: lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null"
  );
}

if (!source.includes("const s = state(jid, name)")) {
  throw new Error("V30 safety check failed: main handler state declaration is missing.");
}

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp runtime fix V30 applied; robust action parsing + incoming diagnostics + accurate connection status + state safety + syntax check passed.");
