import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_RUNTIME_FIX_V20";

function replaceRequired(pattern, replacement, name) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`V20 could not locate ${name}`);
  source = next;
}

replaceRequired(
  /async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}\nasync function list/,
  `async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  const interactiveButtons = clean.map((x) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.text || "").slice(0, 20),
      id: String(x.id || "").slice(0, 200),
    }),
  }));
  try {
    await sock.sendMessage(jid, {
      text,
      footer: "Sweet & Snacks",
      interactiveButtons,
    });
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow button send failed");
    await sock.sendMessage(jid, {
      text: text + "\\n\\n" + clean.map((x, i) => \`${i + 1}. \${x.text}\`).join("\\n"),
    });
  }
}
async function list`,
  "buttons()"
);

replaceRequired(
  /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}\nasync function home/,
  `async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  try {
    if (!clean.length) return sock.sendMessage(jid, { text });
    for (let start = 0; start < clean.length; start += 3) {
      const chunk = clean.slice(start, start + 3);
      const interactiveButtons = chunk.map((x) => ({
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: String(x.title || "").slice(0, 20),
          id: String(x.id || "").slice(0, 200),
        }),
      }));
      await sock.sendMessage(jid, {
        text: start === 0 ? text : "More options:",
        footer: "Sweet & Snacks",
        interactiveButtons,
      });
    }
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow list send failed");
    await sock.sendMessage(jid, {
      text: text + "\\n\\n" + clean.map((x, i) => \`${i + 1}. \${x.title}\`).join("\\n"),
    });
  }
}
async function home`,
  "list()"
);

replaceRequired(
  /const actionOf = \(m\) => \{[\s\S]*?\n\};\nconst incomingLocation/,
  `const actionOf = (m) => {
  const x = unwrap(m?.message);
  const findId = (value) => {
    if (!value) return "";
    if (typeof value === "string") {
      try { return findId(JSON.parse(value)); } catch { return value.trim(); }
    }
    if (typeof value !== "object") return "";
    for (const key of ["id", "button_id", "row_id", "selected_id", "selectedButtonId", "selectedRowId", "selectedId"]) {
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
  "handle() incoming logging"
);

replaceRequired(
  /const text = textOf\(m\), action = actionOf\(m\), location = incomingLocation\(m\), contact = incomingContact\(m\);/,
  `const text = textOf(m), action = actionOf(m), location = incomingLocation(m), contact = incomingContact(m);
  logger.info({ event: "whatsapp.parsed", text, action }, "WhatsApp message parsed");`,
  "parsed action logging"
);

replaceRequired(
  /sock\.ev\.on\("messages\.upsert", async \(\{ messages \}\) => \{ for \(const m of messages\) await handle\(sock, m\); \}\);/,
  `sock.ev.on("messages.upsert", async ({ messages, type }) => {
    logger.info({ event: "whatsapp.messages.upsert", type, count: messages?.length || 0 }, "WhatsApp messages.upsert received");
    for (const m of messages || []) await handle(sock, m);
  });`,
  "messages.upsert listener"
);

if (!source.includes(marker)) source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source);
execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp runtime fix V20 applied; Native Flow + action parsing + incoming diagnostics + syntax check passed.");
