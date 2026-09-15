import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V71";
const source = fs.readFileSync(file, "utf8");

// V71 is a final fail-fast verification for the WhatsApp interactive transport.
// It does not change products, cart, orders, payments, delivery, customers,
// Telegram, Django APIs, database models, or existing action/handler logic.
// The actual transport fix is V64/V67/V69: low-level native-flow relay through
// zqbaileys_helper. V71 makes sure that exact transport is what reaches Render.
const required = [
  "WHATSAPP_RUNTIME_FIX_V67",
  "WHATSAPP_RUNTIME_FIX_V69",
  "zqbaileys_helper",
  "sendInteractiveMessage",
  'name: "quick_reply"',
  'name: "single_select"',
];

for (const item of required) {
  if (!source.includes(item)) {
    throw new Error(`V71 verification failed: missing ${item}`);
  }
}

// These are the exact high-level paths that caused the production
// "Invalid media type" failure and must never be active for buttons/lists.
for (const forbidden of [
  "buttons: clean.map(x => ({ buttonId:",
  "interactiveMessage: {",
  "sendButtons(sock, jid",
  "sendListMessage(sock, jid",
]) {
  if (source.includes(forbidden)) {
    throw new Error(`V71 verification failed: forbidden high-level transport remains active: ${forbidden}`);
  }
}

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

if (!source.includes(marker)) {
  fs.writeFileSync(file, `// ${marker}\n${source}`, "utf8");
}

const finalSource = fs.readFileSync(file, "utf8");
for (const item of [...required, marker]) {
  if (!finalSource.includes(item)) {
    throw new Error(`V71 final verification failed: missing ${item}`);
  }
}

console.log("WhatsApp runtime V71 verification passed; low-level zqbaileys_helper native-flow transport is the only active button/list transport.");
