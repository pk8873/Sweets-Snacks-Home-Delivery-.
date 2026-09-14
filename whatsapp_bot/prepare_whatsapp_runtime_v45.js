import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");

const required = [
  "WHATSAPP_RUNTIME_FIX_V35",
  "generateWAMessageFromContent",
  "proto.Message.InteractiveMessage",
  "NativeFlowButton",
  "sock.relayMessage",
  "additionalNodes",
  "biz_bot",
  "native_flow",
  "quick_reply",
];

const missing = required.filter((token) => !source.includes(token));
if (missing.length) {
  throw new Error(`Final WhatsApp button transport validation failed. Missing: ${missing.join(", ")}`);
}

// V35 keeps the relay implementation in sendNativeFlow(), while buttons()
// intentionally delegates to that helper. The old V45 check incorrectly
// required relayMessage() to appear inside buttons() itself, so it rejected
// the valid V35 implementation on every fresh Render deploy.
if (!/async function sendNativeFlow\(sock, jid, bodyText, items\)[\s\S]*?sock\.relayMessage/.test(source)) {
  throw new Error("Final WhatsApp button transport validation failed: sendNativeFlow() is not using relayMessage().");
}

if (!/async function buttons\(sock, jid, text, items\)[\s\S]*?sendNativeFlow\(sock, jid, text, clean\)/.test(source)) {
  throw new Error("Final WhatsApp button transport validation failed: buttons() is not delegating to sendNativeFlow().");
}

if (!/async function list\(sock, jid, text, rows, title = "Choose"\)[\s\S]*?sendNativeFlow/.test(source)) {
  throw new Error("Final WhatsApp list transport validation failed.");
}

console.log("WhatsApp runtime V45 validation passed; V35 protobuf + relayMessage Native Flow transport is present and buttons()/list() delegate to it.");
