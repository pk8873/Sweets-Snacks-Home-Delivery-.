import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V70";
let source = fs.readFileSync(file, "utf8");

if (!source.includes("WHATSAPP_RUNTIME_FIX_V69")) {
  throw new Error("V70 requires the V69 interactive transport fix.");
}

// V70 is an enforcement/verification layer only. It does not change product,
// cart, order, payment, delivery, customer, Telegram, Django, database, or
// existing WhatsApp action/handler logic. It makes Render fail fast instead of
// silently running an old interactive transport implementation.
const required = [
  "WHATSAPP_RUNTIME_FIX_V69",
  "zqbaileys_helper",
  "sendInteractiveMessage",
  'name: "quick_reply"',
  'name: "single_select"',
];

for (const item of required) {
  if (!source.includes(item)) {
    throw new Error(`V70 verification failed: missing ${item}`);
  }
}

if (source.includes("sendButtons") || source.includes("sendListMessage")) {
  throw new Error("V70 verification failed: convenience interactive transport is still active.");
}

if (source.includes('buttons: clean.map(x => ({ buttonId:')) {
  throw new Error("V70 verification failed: legacy WhatsApp button payload is still active.");
}

if (source.includes("interactiveMessage: {")) {
  throw new Error("V70 verification failed: unsupported high-level interactiveMessage send path is still active.");
}

if (!source.includes(marker)) {
  source = `// ${marker}\n${source}`;
  fs.writeFileSync(file, source, "utf8");
}

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const item of [...required, marker]) {
  if (!finalSource.includes(item)) {
    throw new Error(`V70 final verification failed: missing ${item}`);
  }
}

console.log("WhatsApp runtime V70 verification passed; V69 low-level native-flow transport is enforced and legacy/high-level button transport is rejected.");
