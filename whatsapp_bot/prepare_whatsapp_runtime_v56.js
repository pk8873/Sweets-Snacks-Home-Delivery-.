import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");

// V56 is validation-only. The actual WhatsApp transport fix remains V55.
// This prevents Render from starting with the old V23 high-level payload and
// makes the deployed transport version explicit in the startup logs.
const required = [
  "WHATSAPP_RUNTIME_FIX_V55",
  "async function relayNativeFlow",
  "generateWAMessageFromContent",
  "proto.Message.InteractiveMessage",
  "sock.relayMessage",
  "native_flow",
];

const missing = required.filter((token) => !source.includes(token));
if (missing.length) {
  throw new Error(`V56 validation failed; V55 Native Flow transport is incomplete: ${missing.join(", ")}`);
}

// The old V23 transport is not allowed to remain as the active sender.
if (/sock\.sendMessage\(jid,\s*\{\s*interactiveMessage\s*:/.test(source)) {
  throw new Error("V56 validation failed; old high-level interactiveMessage sender is still active.");
}

execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp runtime fix V56 validation passed; V55 low-level Native Flow relay is active and syntax is valid.");
