import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_BUTTONS_RUNTIME_FIX_V19";

function replaceRequired(pattern, replacement, name) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`V19 could not locate ${name}`);
  source = next;
}

// IMPORTANT: directly replace the actual runtime functions. Older V16/V17
// preparers used newline-sensitive regexes and could silently leave index.js
// unchanged when the source was minified onto one line.
replaceRequired(
  /async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}/,
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
    await sock.sendMessage(jid, { text, footer: "Sweet & Snacks", interactiveButtons });
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow button send failed");
    await sock.sendMessage(jid, { text: text + "\\n\\n" + clean.map((x, i) => (i + 1) + ". " + x.text).join("\\n") });
  }
}`,
  "buttons()"
);

replaceRequired(
  /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}/,
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
    await sock.sendMessage(jid, { text: text + "\\n\\n" + clean.map((x, i) => (i + 1) + ". " + x.title).join("\\n") });
  }
}`,
  "list()"
);

replaceRequired(
  /const textOf = \(m\) => \{[\s\S]*?\n\};/,
  `const textOf = (m) => {
  const x = unwrap(m?.message);
  return String(
    x.conversation || x.extendedTextMessage?.text ||
    x.imageMessage?.caption || x.videoMessage?.caption || x.documentMessage?.caption ||
    x.buttonsResponseMessage?.selectedDisplayText ||
    x.listResponseMessage?.title ||
    x.templateButtonReplyMessage?.selectedDisplayText ||
    x.hydratedTemplateButtonReplyMessage?.selectedDisplayText ||
    x.interactiveResponseMessage?.body?.text || ""
  ).trim();
};`,
  "textOf()"
);

replaceRequired(
  /const actionOf = \(m\) => \{[\s\S]*?\n\};/,
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
  return "";
};`,
  "actionOf()"
);

// Add diagnostic logging immediately after action extraction. This makes a
// future WhatsApp payload mismatch visible instead of silently doing nothing.
const logMarker = "WHATSAPP_BUTTON_ACTION_LOG_V19";
if (!source.includes(logMarker)) {
  const old = `const action = actionOf(m), text = textOf(m);`;
  const next = `// ${logMarker}\n  const action = actionOf(m), text = textOf(m);\n  if (action) logger.info({ action, text, message_type: Object.keys(unwrap(m?.message || {})) }, "WhatsApp interactive action received");`;
  if (source.includes(old)) source = source.replace(old, next);
}

if (!source.includes(marker)) source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source);
execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp buttons runtime fix V19 applied; Native Flow send + response parsing + syntax check passed.");
