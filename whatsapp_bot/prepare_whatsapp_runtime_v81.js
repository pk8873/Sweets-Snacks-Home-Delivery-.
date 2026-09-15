import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V81";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V81 already applied; syntax check passed.");
  process.exit(0);
}

// V81 is the final, isolated WhatsApp interactive-transport fix.
// It does not modify Django, Telegram, products, cart, orders, payments,
// delivery, customers, or action/business logic.
//
// The Render logs proved that the high-level Baileys sendMessage path rejects
// interactiveMessage with "Invalid media type". The zqbaileys_helper package
// provides the required low-level generateWAMessageFromContent + relayMessage
// transport, including the native-flow binary nodes. V81 uses that helper and
// leaves all existing action IDs unchanged.
const helperImportBlock = 'import baileysHelper from "zqbaileys_helper";\nconst { sendInteractiveMessage } = baileysHelper;';
if (!source.includes("sendInteractiveMessage")) {
  const importAnchor = 'import "dotenv/config";';
  if (!source.includes(importAnchor)) {
    throw new Error("V81 could not locate a stable import anchor.");
  }
  source = source.replace(importAnchor, importAnchor + "\n" + helperImportBlock);
} else if (!source.includes('import baileysHelper from "zqbaileys_helper";')) {
  const importAnchor = 'import "dotenv/config";';
  source = source.replace(importAnchor, importAnchor + "\n" + helperImportBlock);
} else if (!source.includes("const { sendInteractiveMessage } = baileysHelper;")) {
  source = source.replace(
    'import baileysHelper from "zqbaileys_helper";',
    helperImportBlock
  );
}

const startToken = "async function buttons(sock, jid, text, items)";
const endToken = "async function home(sock, jid)";
const start = source.indexOf(startToken);
const end = source.indexOf(endToken, start + startToken.length);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("V81 could not locate the active WhatsApp buttons/list transport block.");
}

const replacement = `async function buttons(sock, jid, text, items) {
  const clean = (items || []).filter(Boolean).slice(0, 3);
  if (!clean.length) return;
  const interactiveButtons = clean.map((x) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.text || "").slice(0, 20),
      id: String(x.id || "").slice(0, 200),
    }),
  }));
  try {
    await sendInteractiveMessage(sock, jid, {
      text: String(text || ""),
      footer: "Sweet & Snacks",
      interactiveButtons,
    });
    logger.info({
      event: "whatsapp.native_flow.sent",
      kind: "quick_reply",
      button_count: interactiveButtons.length,
    }, "WhatsApp interactive buttons sent");
  } catch (error) {
    logger.error({
      event: "whatsapp.native_flow.error",
      error: error?.message || error,
      stack: error?.stack,
    }, "WhatsApp interactive button send failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n"),
    });
  }
}

async function list(sock, jid, text, rows, title = "Choose") {
  const clean = (rows || []).filter(Boolean).slice(0, 10);
  if (!clean.length) return;
  const interactiveButtons = [{
    name: "single_select",
    buttonParamsJson: JSON.stringify({
      title: String(title || "Choose").slice(0, 24),
      sections: [{
        title: "Options",
        rows: clean.map((x) => ({
          id: String(x.id || "").slice(0, 200),
          title: String(x.title || "").slice(0, 24),
          description: String(x.description || "").slice(0, 72),
        })),
      }],
    }),
  }];
  try {
    await sendInteractiveMessage(sock, jid, {
      text: String(text || ""),
      footer: "Sweet & Snacks",
      interactiveButtons,
    });
    logger.info({
      event: "whatsapp.native_flow.sent",
      kind: "single_select",
      row_count: clean.length,
    }, "WhatsApp interactive list sent");
  } catch (error) {
    logger.error({
      event: "whatsapp.native_flow.list_error",
      error: error?.message || error,
      stack: error?.stack,
    }, "WhatsApp interactive list send failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n"),
    });
  }
}

`;

source = source.slice(0, start) + replacement + source.slice(end);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
const finalStart = finalSource.indexOf(startToken);
const finalEnd = finalSource.indexOf(endToken, finalStart + startToken.length);
if (finalStart < 0 || finalEnd <= finalStart) {
  throw new Error("V81 validation failed: active transport block not found.");
}
const active = finalSource.slice(finalStart, finalEnd);
for (const required of [
  marker,
  'import baileysHelper from "zqbaileys_helper";',
  "const { sendInteractiveMessage } = baileysHelper;",
  "sendInteractiveMessage(sock, jid",
  'name: "quick_reply"',
  'name: "single_select"',
]) {
  if (!finalSource.includes(required)) {
    throw new Error(`V81 validation failed: missing ${required}`);
  }
}
for (const forbidden of [
  "buttons: clean.map(x => ({ buttonId:",
  "buttonText: { displayText:",
  'await sock.sendMessage(jid, { title: "🍬 Sweet & Snacks"',
  "interactiveMessage: {",
]) {
  if (active.includes(forbidden)) {
    throw new Error(`V81 validation failed: incompatible transport remains: ${forbidden}`);
  }
}

const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") {
  throw new Error("V81 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");
}

console.log("WhatsApp runtime V81 applied; helper low-level Native Flow transport enforced, legacy/high-level button transport removed, and syntax check passed.");
