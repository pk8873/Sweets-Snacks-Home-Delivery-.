import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const requiredSource = [
  "WHATSAPP_RUNTIME_FIX_V77",
  "sendInteractiveMessage(sock, jid",
  'name: "quick_reply"',
  'name: "single_select"',
];
for (const token of requiredSource) {
  if (!source.includes(token)) {
    throw new Error(`V79 verification failed: missing active transport token: ${token}`);
  }
}

if (!packageJson.dependencies?.zqbaileys_helper) {
  throw new Error("V79 verification failed: zqbaileys_helper dependency is missing.");
}

const start = source.indexOf("async function buttons(sock, jid, text, items)");
const end = source.indexOf("async function home(sock, jid)", start + 1);
if (start < 0 || end <= start) {
  throw new Error("V79 verification failed: active WhatsApp transport block not found.");
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
    throw new Error(`V79 verification failed: old button transport remains: ${token}`);
  }
}

console.log("WhatsApp runtime V79 verification passed: helper Native Flow transport is active and legacy button transport is absent.");
