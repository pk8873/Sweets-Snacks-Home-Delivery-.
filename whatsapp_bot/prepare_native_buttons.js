import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_NATIVE_BUTTONS_FINAL_V18";
if (!source.includes(marker)) {
  const buttonsPattern = /async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}\nasync function list/;
  const buttonsReplacement = `async function buttons(sock, jid, text, items) {
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
    console.error("WhatsApp quick-reply send failed:", error?.message || error);
    await sock.sendMessage(jid, { text: text + "\\n\\n" + clean.map((x, i) => (i + 1) + ". " + x.text).join("\\n") });
  }
}
async function list`;
  const patchedButtons = source.replace(buttonsPattern, buttonsReplacement);
  if (patchedButtons === source) throw new Error("Final V18 could not locate buttons().");
  source = patchedButtons;

  const listPattern = /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}\nasync function home/;
  const listReplacement = `async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  try {
    if (!clean.length) return sock.sendMessage(jid, { text });
    for (let start = 0; start < clean.length; start += 3) {
      const chunk = clean.slice(start, start + 3);
      const heading = start === 0 ? text : "More options:";
      const interactiveButtons = chunk.map((x) => ({
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: String(x.title || "").slice(0, 20),
          id: String(x.id || "").slice(0, 200),
        }),
      }));
      await sock.sendMessage(jid, { text: heading, footer: "Sweet & Snacks", interactiveButtons });
    }
  } catch (error) {
    console.error("WhatsApp list send failed:", error?.message || error);
    await sock.sendMessage(jid, { text: text + "\\n\\n" + clean.map((x, i) => (i + 1) + ". " + x.title).join("\\n") });
  }
}
async function home`;
  const patchedList = source.replace(listPattern, listReplacement);
  if (patchedList === source) throw new Error("Final V18 could not locate list().");
  source = patchedList;

  source = `// ${marker}\\n${source}`;
}

// Always repair the action parser. This is intentionally independent from the
// older prepare scripts so a stale marker can never leave the bot with a bad parser.
const actionPattern = /const actionOf = \(m\) => \{[\s\S]*?\};\nconst incomingLocation/;
const actionReplacement = `const actionOf = (m) => {
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
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.buttonParamsJson,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson,
  ];
  for (const candidate of candidates) {
    const id = findId(candidate);
    if (id) return id;
  }
  return "";
};
const incomingLocation`;
const patchedAction = source.replace(actionPattern, actionReplacement);
if (patchedAction === source) throw new Error("Final V18 could not locate actionOf().");
source = patchedAction;

const textPattern = /const textOf = \(m\) => \{[\s\S]*?\};\nconst actionOf/;
const textReplacement = `const textOf = (m) => {
  const x = unwrap(m?.message);
  return String(x.conversation || x.extendedTextMessage?.text || x.imageMessage?.caption || x.videoMessage?.caption || x.documentMessage?.caption || x.buttonsResponseMessage?.selectedDisplayText || x.listResponseMessage?.title || x.templateButtonReplyMessage?.selectedDisplayText || x.hydratedTemplateButtonReplyMessage?.selectedDisplayText || x.interactiveResponseMessage?.body?.text || "").trim();
};
const actionOf`;
const patchedText = source.replace(textPattern, textReplacement);
if (patchedText === source) throw new Error("Final V18 could not locate textOf().");
source = patchedText;

fs.writeFileSync(file, source);
execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp final Native Flow buttons/list/action patch V18 applied; syntax check passed.");
