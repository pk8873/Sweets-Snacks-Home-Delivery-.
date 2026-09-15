import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V66";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V66 already applied; syntax check passed.");
  process.exit(0);
}

if (!source.includes('from "zqbaileys_helper"') || !source.includes("sendInteractiveMessage")) {
  throw new Error("V66 requires the zqbaileys_helper transport installed by V64/V65.");
}

const helperImport = 'import baileysHelper from "zqbaileys_helper";\nconst { sendInteractiveMessage } = baileysHelper;';
const replacementImport = 'import baileysHelper from "zqbaileys_helper";\nconst { sendButtons, sendListMessage } = baileysHelper;';
if (source.includes(helperImport)) {
  source = source.replace(helperImport, replacementImport);
} else {
  throw new Error("V66 could not locate the existing zqbaileys_helper import.");
}

const startToken = "async function buttons(sock, jid, text, items)";
const endToken = "async function home(sock, jid)";
const start = source.indexOf(startToken);
const end = source.indexOf(endToken, start + startToken.length);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("V66 could not locate the current buttons/list transport block.");
}

const replacement = `async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  if (!clean.length) return;
  try {
    await sendButtons(sock, jid, {
      text: String(text || ""),
      footer: "Sweet & Snacks",
      buttons: clean.map((x) => ({
        id: String(x.id || "").slice(0, 200),
        text: String(x.text || "").slice(0, 20),
      })),
    });
    logger.info({ event: "whatsapp.interactive.sent", kind: "buttons", count: clean.length }, "WhatsApp clickable buttons sent");
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "WhatsApp button transport failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n"),
    });
  }
}

async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return;
  try {
    await sendListMessage(sock, jid, {
      text: String(text || ""),
      footer: "Sweet & Snacks",
      title: "🍬 Sweet & Snacks",
      buttonText: String(title || "Choose").slice(0, 24),
      sections: [{
        title: "Options",
        rows: clean.map((x) => ({
          rowId: String(x.id || "").slice(0, 200),
          title: String(x.title || "").slice(0, 24),
          description: String(x.description || "").slice(0, 72),
        })),
      }],
    });
    logger.info({ event: "whatsapp.interactive.sent", kind: "list", count: clean.length }, "WhatsApp clickable list sent");
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "WhatsApp list transport failed");
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
for (const required of [marker, "sendButtons", "sendListMessage"]) {
  if (!finalSource.includes(required)) throw new Error(`V66 validation failed: missing ${required}`);
}
if (finalSource.includes("sendInteractiveMessage")) {
  throw new Error("V66 validation failed: old helper transport remains imported.");
}

const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendButtons !== "function" || typeof helper?.sendListMessage !== "function") {
  throw new Error("V66 validation failed: required helper exports are unavailable.");
}

console.log("WhatsApp runtime V66 applied; helper sendButtons/sendListMessage transport + syntax validation passed.");
