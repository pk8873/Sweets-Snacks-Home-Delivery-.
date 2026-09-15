import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));

const required = [
  "WHATSAPP_RUNTIME_FIX_V77",
  'import * as baileysHelperModule from "zqbaileys_helper";',
  "const { sendInteractiveMessage } = baileysHelper;",
  "sendInteractiveMessage(sock, jid",
  'name: "quick_reply"',
  'name: "single_select"',
];

for (const token of required) {
  if (!source.includes(token)) {
    throw new Error(`V80 transport verification failed: missing ${token}`);
  }
}

if (!pkg.dependencies?.zqbaileys_helper) {
  throw new Error("V80 transport verification failed: helper dependency missing");
}

const start = source.indexOf("async function buttons(sock, jid, text, items)");
const end = source.indexOf("async function home(sock, jid)", start + 1);
if (start < 0 || end <= start) {
  throw new Error("V80 transport verification failed: active button block missing");
}

const active = source.slice(start, end);
if (active.includes("interactiveMessage: {")) {
  throw new Error("V80 transport verification failed: incompatible high-level interactiveMessage remains active");
}
if (!active.includes("sendInteractiveMessage(sock, jid")) {
  throw new Error("V80 transport verification failed: helper relay not active");
}

console.log("WhatsApp runtime V80 verification passed: helper Native Flow relay is the active button/list transport.");
