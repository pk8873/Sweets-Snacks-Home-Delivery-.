import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const source = fs.readFileSync(file, "utf8");

const required = [
  "WHATSAPP_RUNTIME_FIX_V59",
  "async function relayNativeFlow",
  "await sock.relayMessage(jid, waMessage.message",
  "additionalNodes: [botNode, bizNode]",
  "async function buttons(sock, jid, text, items)",
];

for (const needle of required) {
  if (!source.includes(needle)) {
    throw new Error(`WhatsApp runtime V60 validation failed: missing ${needle}`);
  }
}

const buttonsStart = source.indexOf("async function buttons(sock, jid, text, items)");
const homeStart = source.indexOf("async function home(sock, jid)");
if (buttonsStart < 0 || homeStart < 0 || homeStart <= buttonsStart) {
  throw new Error("WhatsApp runtime V60 validation failed: buttons/home boundaries are invalid.");
}

const buttonsBlock = source.slice(buttonsStart, homeStart);
if (buttonsBlock.includes("sock.sendMessage(jid, { text, footer: \"Sweet & Snacks\", buttons:")) {
  throw new Error("WhatsApp runtime V60 validation failed: legacy button sender is still active.");
}

if (buttonsBlock.includes("viewOnceMessage")) {
  throw new Error("WhatsApp runtime V60 validation failed: viewOnce wrapper is still active around buttons.");
}

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V60 validation passed; V59 low-level Native Flow relay is active and legacy button transport is disabled.");
