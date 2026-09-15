import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");

// V78 is intentionally a deployment-safe finalizer. It does not alter
// Django, Telegram, cart, order, payment, delivery, customer, or action logic.
// It verifies that the V77 low-level interactive transport is present before
// the WhatsApp process starts. V77 is the actual transport fix.
const required = [
  "WHATSAPP_RUNTIME_FIX_V77",
  'import * as baileysHelperModule from "zqbaileys_helper";',
  "const { sendInteractiveMessage } = baileysHelper;",
  "sendInteractiveMessage(sock, jid",
  'name: \"quick_reply\"',
  'name: \"single_select\"',
];

for (const token of required) {
  if (!source.includes(token)) {
    throw new Error(`V78 verification failed: missing ${token}`);
  }
}

const start = source.indexOf("async function buttons(sock, jid, text, items)");
const end = source.indexOf("async function home(sock, jid)", start + 1);
if (start < 0 || end <= start) {
  throw new Error("V78 verification failed: active WhatsApp transport block not found.");
}

const active = source.slice(start, end);
const forbidden = [
  "buttons: clean.map(x => ({ buttonId:",
  "buttonText: { displayText:",
  'await sock.sendMessage(jid, { title: "🍬 Sweet & Snacks"',
  "interactiveMessage: {",
];
for (const token of forbidden) {
  if (active.includes(token)) {
    throw new Error(`V78 verification failed: legacy/high-level transport remains: ${token}`);
  }
}

execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp runtime V78 verification passed; V77 low-level Native Flow transport is active and legacy button transport is absent.");
