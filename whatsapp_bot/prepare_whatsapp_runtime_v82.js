import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V82";
let source = fs.readFileSync(file, "utf8");

// V82 remains idempotent for the transport itself, but if an already-patched
// deployment still contains mdPatch:false, upgrade that exact transport in place.
if (source.includes(marker)) {
  const startToken = "async function buttons(sock, jid, text, items)";
  const endToken = "async function home(sock, jid)";
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start >= 0 && end > start) {
    const active = source.slice(start, end);
    if (active.includes("sendInteractiveMessage(sock, jid") && active.includes("mdPatch: false")) {
      source = source.slice(0, start) + active.replace(/\{ mdPatch: false \}/g, "{ mdPatch: true }") + source.slice(end);
      fs.writeFileSync(file, source, "utf8");
      console.log("WhatsApp runtime V82 compatibility upgrade applied: mdPatch enabled.");
    }
  }
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  process.exit(0);
}

// V82 is intentionally limited to the WhatsApp interactive-message transport.
// It preserves all existing action IDs and Django/business logic.
// The zqbaileys_helper low-level relay is used because the normal Baileys
// sendMessage path rejects interactiveMessage as "Invalid media type".
const startToken = "async function buttons(sock, jid, text, items)";
const endToken = "async function home(sock, jid)";
const start = source.indexOf(startToken);
const end = source.indexOf(endToken, start + startToken.length);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("V82 could not locate the active WhatsApp buttons/list transport block.");
}

const active = source.slice(start, end);
if (!active.includes("sendInteractiveMessage(sock, jid")) {
  throw new Error("V82 expected the V81 helper-based interactive transport to be active.");
}

const patched = active
  .replace(
    /sendInteractiveMessage\(sock, jid, \{([\s\S]*?)\}\);/g,
    "sendInteractiveMessage(sock, jid, {$1}, { mdPatch: true });"
  );

if (patched === active) {
  throw new Error("V82 could not locate helper sendInteractiveMessage calls.");
}

source = source.slice(0, start) + patched + source.slice(end);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
const finalStart = finalSource.indexOf(startToken);
const finalEnd = finalSource.indexOf(endToken, finalStart + startToken.length);
if (finalStart < 0 || finalEnd <= finalStart) {
  throw new Error("V82 validation failed: active transport block not found.");
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
    throw new Error(`V82 validation failed: missing ${required}`);
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
    throw new Error(`V82 validation failed: incompatible transport remains: ${forbidden}`);
  }
}

const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") {
  throw new Error("V82 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");
}

console.log("WhatsApp runtime V82 applied; helper low-level Native Flow relay with MD compatibility enabled, legacy transport removed, and syntax check passed.");
