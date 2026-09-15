import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V77";
let source = fs.readFileSync(file, "utf8");

function ensureHelperImport(input) {
  if (input.includes('import * as baileysHelperModule from "zqbaileys_helper";') && input.includes("const { sendInteractiveMessage } = baileysHelper;")) {
    return input;
  }
  const anchor = 'import qrcode from "qrcode-terminal";';
  const helperBlock = 'import * as baileysHelperModule from "zqbaileys_helper";\nconst baileysHelper = baileysHelperModule.default || baileysHelperModule;\nconst { sendInteractiveMessage } = baileysHelper;';
  if (input.includes('import * as baileysHelperModule from "zqbaileys_helper";')) {
    const start = input.indexOf('import * as baileysHelperModule from "zqbaileys_helper";');
    const end = input.indexOf(';', input.indexOf("const baileysHelper =", start));
    if (end >= 0 && !input.includes("const { sendInteractiveMessage } = baileysHelper;")) {
      return input.slice(0, end + 1) + '\nconst { sendInteractiveMessage } = baileysHelper;' + input.slice(end + 1);
    }
    return input;
  }
  if (!input.includes(anchor)) throw new Error("V77: qrcode import anchor not found.");
  return input.replace(anchor, anchor + "\n" + helperBlock);
}

source = ensureHelperImport(source);

const start = source.indexOf("async function buttons(sock, jid, text, items)");
const end = source.indexOf("async function home(sock, jid)", start + 1);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("V77: active WhatsApp button/list transport block not found.");
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
source = `// ${marker}\n` + source.replace(/^\/\/ WHATSAPP_RUNTIME_FIX_V(?:6[0-9]|7[0-6])\n?/m, "");
fs.writeFileSync(file, source, "utf8");

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
const finalSource = fs.readFileSync(file, "utf8");
const finalStart = finalSource.indexOf("async function buttons(sock, jid, text, items)");
const finalEnd = finalSource.indexOf("async function home(sock, jid)", finalStart + 1);
if (finalStart < 0 || finalEnd <= finalStart) throw new Error("V77 validation: active transport block not found after patch.");
const active = finalSource.slice(finalStart, finalEnd);
for (const required of [
  marker,
  'import * as baileysHelperModule from "zqbaileys_helper";',
  "const { sendInteractiveMessage } = baileysHelper;",
  "sendInteractiveMessage(sock, jid",
  'name: "quick_reply"',
  'name: "single_select"',
]) {
  if (!finalSource.includes(required)) throw new Error(`V77 validation failed: missing ${required}`);
}
for (const forbidden of [
  "buttons: clean.map(x => ({ buttonId:",
  "buttonText: { displayText:",
  'await sock.sendMessage(jid, { title: "🍬 Sweet & Snacks"',
  "interactiveMessage: {",
]) {
  if (active.includes(forbidden)) throw new Error(`V77 validation failed: forbidden transport remains: ${forbidden}`);
}
const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") {
  throw new Error("V77 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");
}
console.log("WhatsApp runtime V77 applied; helper low-level Native Flow transport enforced, legacy/high-level transport removed, and syntax check passed.");
