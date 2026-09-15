import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V67";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V67 already applied; syntax check passed.");
  process.exit(0);
}

// V67 deliberately uses the helper's low-level sendInteractiveMessage API.
// V66's convenience sendButtons/sendListMessage path can re-enter a higher-level
// message conversion path on some WhiskeySockets builds. V67 keeps the proven
// low-level relay path from V64, which constructs the native-flow protobuf and
// injects the required biz/interactive/native_flow/bot nodes.
const helperImport = 'import baileysHelper from "zqbaileys_helper";';
if (!source.includes(helperImport)) {
  throw new Error("V67 could not locate zqbaileys_helper import.");
}

source = source.replace(
  /const \{\s*sendButtons\s*,\s*sendListMessage\s*\}\s*=\s*baileysHelper;/,
  'const { sendInteractiveMessage } = baileysHelper;'
);

if (!source.includes("sendInteractiveMessage")) {
  throw new Error("V67 could not enable sendInteractiveMessage.");
}

const startToken = "async function buttons(sock, jid, text, items)";
const endToken = "async function home(sock, jid)";
const start = source.indexOf(startToken);
const end = source.indexOf(endToken, start + startToken.length);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("V67 could not locate the current buttons/list transport block.");
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
    logger.info({ event: "whatsapp.native_flow.sent", kind: "quick_reply", button_count: interactiveButtons.length }, "WhatsApp interactive buttons sent");
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "WhatsApp interactive button send failed");
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
    logger.info({ event: "whatsapp.native_flow.sent", kind: "single_select", row_count: clean.length }, "WhatsApp interactive list sent");
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "WhatsApp interactive list send failed");
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
for (const required of [
  marker,
  'from "zqbaileys_helper"',
  "sendInteractiveMessage",
  'name: "quick_reply"',
  'name: "single_select"',
]) {
  if (!finalSource.includes(required)) {
    throw new Error(`V67 validation failed: missing ${required}`);
  }
}
if (finalSource.includes("sendButtons") || finalSource.includes("sendListMessage")) {
  throw new Error("V67 validation failed: V66 convenience transport remains active.");
}

const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") {
  throw new Error("V67 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");
}

console.log("WhatsApp runtime V67 applied; low-level native-flow relay + quick replies + single-select list + syntax validation passed.");
