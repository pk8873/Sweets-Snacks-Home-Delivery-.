import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V72";
const source = fs.readFileSync(file, "utf8");

// V72 is intentionally transport-only. It does not modify products, cart,
// orders, payments, delivery, customers, Telegram, Django, DB, or handlers.
// It guarantees that Render starts with the V69 low-level helper transport
// instead of the old high-level buttons/list path that caused Invalid media type.
const required = [
  "WHATSAPP_RUNTIME_FIX_V69",
  "zqbaileys_helper",
  "sendInteractiveMessage",
  'name: "quick_reply"',
  'name: "single_select"',
];

for (const item of required) {
  if (!source.includes(item)) {
    throw new Error(`V72 verification failed: missing ${item}`);
  }
}

for (const forbidden of [
  "buttons: clean.map(x => ({ buttonId:",
  "interactiveMessage: {",
  "sendButtons(sock, jid",
  "sendListMessage(sock, jid",
]) {
  if (source.includes(forbidden)) {
    throw new Error(`V72 verification failed: forbidden old transport remains active: ${forbidden}`);
  }
}

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

if (!source.includes(marker)) {
  fs.writeFileSync(file, `// ${marker}\n${source}`, "utf8");
}

const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") {
  throw new Error("V72 verification failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");
}

const finalSource = fs.readFileSync(file, "utf8");
for (const item of [...required, marker]) {
  if (!finalSource.includes(item)) {
    throw new Error(`V72 final verification failed: missing ${item}`);
  }
}

console.log("WhatsApp runtime V72 applied; current low-level zqbaileys_helper Native Flow transport verified and ready for Render.");
