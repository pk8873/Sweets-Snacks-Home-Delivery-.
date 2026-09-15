import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V76";
let source = fs.readFileSync(file, "utf8");

// V76 is the final transport-only fix. It deliberately returns the WhatsApp
// button/list layer to the tested zqbaileys_helper transport. It does not
// change any Django, product, cart, order, payment, delivery, customer,
// Telegram, database, or action-handler logic.

if (!source.includes('from "zqbaileys_helper"')) {
  const anchor = 'import qrcode from "qrcode-terminal";';
  if (!source.includes(anchor)) throw new Error("V76 could not locate qrcode import anchor.");
  source = source.replace(
    anchor,
    anchor + '\nimport * as baileysHelperModule from "zqbaileys_helper";\nconst baileysHelper = baileysHelperModule.default || baileysHelperModule;\nconst { sendInteractiveMessage } = baileysHelper;'
  );
} else if (!source.includes("const { sendInteractiveMessage } = baileysHelper;")) {
  const helperImport = 'import * as baileysHelperModule from "zqbaileys_helper";\nconst baileysHelper = baileysHelperModule.default || baileysHelperModule;';
  if (source.includes(helperImport)) {
    source = source.replace(helperImport, helperImport + '\nconst { sendInteractiveMessage } = baileysHelper;');
  } else if (source.includes('import baileysHelper from "zqbaileys_helper";')) {
    source = source.replace(
      'import baileysHelper from "zqbaileys_helper";',
      helperImport + '\nconst { sendInteractiveMessage } = baileysHelper;'
    );
  } else {
    throw new Error("V76 could not locate zqbaileys_helper import block.");
  }
}

// Remove the direct-protobuf V74/V75 import. The helper owns the low-level
// relay construction and injects the required biz/interactive/native_flow/bot nodes.
source = source.replace(
  'import { proto, generateWAMessageFromContent, isJidGroup } from "@whiskeysockets/baileys";\n',
  ''
);

const startCandidates = [
  "async function sendNativeFlow(sock, jid, text, nativeButtons)",
  "async function buttons(sock, jid, text, items)",
];
const endToken = "async function home(sock, jid)";
let start = -1;
let startToken = "";
for (const candidate of startCandidates) {
  const idx = source.indexOf(candidate);
  if (idx >= 0 && (start < 0 || idx < start)) {
    start = idx;
    startToken = candidate;
  }
}
const end = source.indexOf(endToken, start + 1);
if (start < 0 || end < 0 || end <= start) {
  throw new Error(`V76 could not locate WhatsApp interactive transport block (${startToken || "none"}).`);
}

const replacement = `async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
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
      error: error?.message || error,
      stack: error?.stack,
      event: "whatsapp.native_flow.error",
    }, "WhatsApp interactive button send failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n"),
    });
  }
}

async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
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
      error: error?.message || error,
      stack: error?.stack,
      event: "whatsapp.native_flow.list_error",
    }, "WhatsApp interactive list send failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n"),
    });
  }
}

`;

source = source.slice(0, start) + replacement + source.slice(end);

// V76 is the final marker. Remove stale transport markers only from the
// transport layer comments; leaving older lifecycle markers is intentional.
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const required of [
  marker,
  'from "zqbaileys_helper"',
  "const baileysHelper = baileysHelperModule.default || baileysHelperModule;",
  "const { sendInteractiveMessage } = baileysHelper;",
  "sendInteractiveMessage(sock, jid",
  'name: "quick_reply"',
  'name: "single_select"',
  'event: "whatsapp.native_flow.sent"',
]) {
  if (!finalSource.includes(required)) throw new Error(`V76 validation failed: missing ${required}`);
}

for (const forbidden of [
  "async function sendNativeFlow(sock, jid",
  'buttons: clean.map(x => ({ buttonId:',
  'buttonText: { displayText:',
  'await sock.sendMessage(jid, { title: "🍬 Sweet & Snacks"',
  'interactiveMessage: {',
  'generateWAMessageFromContent',
]) {
  if (finalSource.includes(forbidden)) {
    throw new Error(`V76 validation failed: stale transport remains active: ${forbidden}`);
  }
}

const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") {
  throw new Error("V76 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");
}

console.log("WhatsApp runtime V76 applied; helper low-level native-flow transport restored + legacy/high-level transport removed + syntax check passed.");
