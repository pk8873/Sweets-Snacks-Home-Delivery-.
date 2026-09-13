import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

// V16: use WhatsApp Native Flow quick-reply buttons instead of the legacy
// `buttons`/`sections` message format. Recent WhatsApp clients/Baileys builds
// may display legacy buttons as plain text, which makes them look unclickable.
const nativeMarker = "WHATSAPP_NATIVE_FLOW_BUTTONS_V16";
if (!source.includes(nativeMarker)) {
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
    await sock.sendMessage(jid, {
      text,
      footer: "Sweet & Snacks",
      interactiveButtons,
    });
  } catch (error) {
    console.error("Native Flow quick-reply send failed:", error?.message || error);
    await sock.sendMessage(jid, {
      text: \\`${text}\\n\\n${clean.map((x, i) => \\`${i + 1}. ${x.text}\\`).join("\\n")}\\`,
    });
  }
}
async function list`;
  const patchedButtons = source.replace(buttonsPattern, buttonsReplacement);
  if (patchedButtons === source) throw new Error("Unable to replace WhatsApp buttons() function for V16.");
  source = patchedButtons;

  const listPattern = /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}\nasync function home/;
  const listReplacement = `async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  const interactiveButtons = clean.slice(0, 3).map((x) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.title || "").slice(0, 20),
      id: String(x.id || "").slice(0, 200),
    }),
  }));

  try {
    if (interactiveButtons.length) {
      await sock.sendMessage(jid, {
        text: `${text}\\n\\n${clean.length > 3 ? "More options are available below." : ""}`.trim(),
        footer: "Sweet & Snacks",
        interactiveButtons,
      });
    } else {
      await sock.sendMessage(jid, { text });
    }
  } catch (error) {
    console.error("Native Flow list send failed:", error?.message || error);
    await sock.sendMessage(jid, {
      text: `${text}\\n\\n${clean.map((x, i) => `${i + 1}. ${x.title}`).join("\\n")}`,
    });
  }
}
async function home`;
  const patchedList = source.replace(listPattern, listReplacement);
  if (patchedList === source) throw new Error("Unable to replace WhatsApp list() function for V16.");
  source = patchedList;

  source = `// ${nativeMarker}\\n${source}`;
  fs.writeFileSync(file, source);
  console.log("WhatsApp Native Flow button/list patch V16 applied.");
} else {
  console.log("WhatsApp Native Flow button/list patch V16 already applied.");
}

// V17: accept all common native-flow and legacy response payload shapes.
const actionMarker = "WHATSAPP_ACTION_PARSER_V17";
if (!source.includes(actionMarker)) {
  const actionPattern = /const actionOf = \(m\) => \{[\s\S]*?\};\nconst incomingLocation/;
  const actionReplacement = `const actionOf = (m) => {
  const x = unwrap(m?.message);

  const findId = (value) => {
    if (!value) return "";
    if (typeof value === "string") {
      try { return findId(JSON.parse(value)); } catch { return value.trim(); }
    }
    if (typeof value !== "object") return "";
    const keys = [
      "id", "button_id", "row_id", "selected_id",
      "selectedButtonId", "selectedRowId", "selectedId",
    ];
    for (const key of keys) {
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
  if (patchedAction === source) throw new Error("Unable to replace WhatsApp action parser for V17.");
  source = patchedAction;
  source = `// ${actionMarker}\\n${source}`;
}

// V17 text parser also recognizes native-flow selected text.
const textMarker = "WHATSAPP_TEXT_PARSER_V17";
if (!source.includes(textMarker)) {
  const textPattern = /const textOf = \(m\) => \{[\s\S]*?\};\nconst actionOf/;
  const textReplacement = `const textOf = (m) => {
  const x = unwrap(m?.message);
  return String(
    x.conversation ||
    x.extendedTextMessage?.text ||
    x.imageMessage?.caption ||
    x.videoMessage?.caption ||
    x.documentMessage?.caption ||
    x.buttonsResponseMessage?.selectedDisplayText ||
    x.listResponseMessage?.title ||
    x.templateButtonReplyMessage?.selectedDisplayText ||
    x.hydratedTemplateButtonReplyMessage?.selectedDisplayText ||
    x.interactiveResponseMessage?.body?.text ||
    ""
  ).trim();
};
const actionOf`;
  const patchedText = source.replace(textPattern, textReplacement);
  if (patchedText === source) throw new Error("Unable to replace WhatsApp text parser for V17.");
  source = patchedText;
  source = `// ${textMarker}\\n${source}`;
}

// Keep the source deploy-safe: fail the Render build/startup if a malformed
// generated JavaScript file is ever produced.
execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
fs.writeFileSync(file, source);
console.log("WhatsApp button/action compatibility patches V16/V17 applied; JavaScript syntax check passed.");
