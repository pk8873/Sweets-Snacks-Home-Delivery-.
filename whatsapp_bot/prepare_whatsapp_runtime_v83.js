import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V83";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V83 already applied; syntax check passed.");
  process.exit(0);
}

const startToken = "async function buttons(sock, jid, text, items)";
const endToken = "async function home(sock, jid)";
const start = source.indexOf(startToken);
const end = source.indexOf(endToken, start + startToken.length);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("V83 could not locate the active WhatsApp interactive transport block.");
}

const active = source.slice(start, end);
if (!active.includes("sendInteractiveMessage(sock, jid")) {
  throw new Error("V83 expected the helper-based interactive transport to be active.");
}

// The helper's MD compatibility patch is enabled here intentionally. It wraps
// the native-flow message in the FutureProof/documentWithCaption envelope used
// by WhatsApp-compatible clients while keeping the existing action IDs intact.
const patched = active.replace(/\{ mdPatch: false \}/g, "{ mdPatch: true }");
if (patched === active) {
  throw new Error("V83 could not locate mdPatch: false in the active transport.");
}

source = source.slice(0, start) + patched + source.slice(end);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
const finalStart = finalSource.indexOf(startToken);
const finalEnd = finalSource.indexOf(endToken, finalStart + startToken.length);
if (finalStart < 0 || finalEnd <= finalStart) {
  throw new Error("V83 validation failed: active transport block not found.");
}
const finalActive = finalSource.slice(finalStart, finalEnd);

for (const required of [
  marker,
  'import baileysHelper from "zqbaileys_helper";',
  "const { sendInteractiveMessage } = baileysHelper;",
  "sendInteractiveMessage(sock, jid",
  "mdPatch: true",
  'name: "quick_reply"',
  'name: "single_select"',
]) {
  if (!finalSource.includes(required)) {
    throw new Error(`V83 validation failed: missing ${required}`);
  }
}

for (const forbidden of [
  "buttons: clean.map(x => ({ buttonId:",
  "buttonText: { displayText:",
  'await sock.sendMessage(jid, { title: "🍬 Sweet & Snacks"',
  "interactiveMessage: {",
  "mdPatch: false",
]) {
  if (finalActive.includes(forbidden)) {
    throw new Error(`V83 validation failed: incompatible transport remains: ${forbidden}`);
  }
}

console.log("WhatsApp runtime V83 applied; helper Native Flow relay + MD compatibility enabled, legacy transport removed, and syntax check passed.");
