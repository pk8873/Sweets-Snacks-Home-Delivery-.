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

if (!/async function buttons\(sock, jid, text, items\)[\s\S]*?sock\.relayMessage/.test(source)) {
  throw new Error("Final WhatsApp button transport validation failed: buttons() is not using relayMessage().");
}

if (!/async function list\(sock, jid, text, rows, title = "Choose"\)[\s\S]*?single_select|async function list\(sock, jid, text, rows, title = "Choose"\)[\s\S]*?sendNativeFlow/.test(source)) {
  throw new Error("Final WhatsApp list transport validation failed.");
}

console.log("WhatsApp runtime V45 validation passed; final button/list transport is the V35 protobuf + relayMessage implementation.");
