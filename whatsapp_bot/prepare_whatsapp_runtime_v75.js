import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V75";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V75 already applied; syntax check passed.");
  process.exit(0);
}

// V75 is a transport-only correction to V74. It does not change any Django,
// product, cart, order, payment, delivery, customer, Telegram, or action logic.
// V74 correctly bypasses WhiskeySockets' Invalid media type path, but its biz
// relay node was missing the attributes WhatsApp expects for native-flow UI.
// Add the required biz attributes + quality-control child while preserving the
// existing direct protobuf + relayMessage implementation and every action ID.
if (!source.includes("WHATSAPP_RUNTIME_FIX_V74")) {
  throw new Error("V75 requires the V74 interactive transport layer.");
}

const oldBiz = `  const bizNode = {
    tag: "biz",
    attrs: {},
    content: [{
      tag: "interactive",
      attrs: { type: "native_flow", v: "1" },
      content: [{
        tag: "native_flow",
        attrs: { v: "9", name: "mixed" },
      }],
    }],
  };`;

const newBiz = `  const privacyModeTs = String(Math.floor(Date.now() / 1000) - 77980457);
  const bizNode = {
    tag: "biz",
    attrs: {
      actual_actors: "2",
      host_storage: "2",
      privacy_mode_ts: privacyModeTs,
    },
    content: [{
      tag: "interactive",
      attrs: { type: "native_flow", v: "1" },
      content: [{
        tag: "native_flow",
        attrs: { v: "9", name: "mixed" },
      }],
    }, {
      tag: "quality_control",
      attrs: { source_type: "third_party" },
    }],
  };`;

if (!source.includes(oldBiz)) {
  throw new Error("V75 could not locate the V74 biz relay node.");
}

source = source.replace(oldBiz, newBiz);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const required of [
  marker,
  "WHATSAPP_RUNTIME_FIX_V74",
  "sendNativeFlow(sock, jid",
  "generateWAMessageFromContent",
  "messageVersion: 1",
  'name: "quick_reply"',
  'tag: "biz"',
  'actual_actors: "2"',
  'host_storage: "2"',
  "privacy_mode_ts",
  'tag: "quality_control"',
  'source_type: "third_party"',
  'biz_bot: "1"',
]) {
  if (!finalSource.includes(required)) {
    throw new Error(`V75 validation failed: missing ${required}`);
  }
}

if (finalSource.includes('attrs: {},\n    content: [{\n      tag: "interactive"')) {
  throw new Error("V75 validation failed: incomplete biz relay attributes remain active.");
}
if (finalSource.includes('buttons: clean.map(x => ({ buttonId:') || finalSource.includes('buttonText: { displayText:')) {
  throw new Error("V75 validation failed: legacy button transport remains active.");
}
if (finalSource.includes('interactiveMessage: {')) {
  throw new Error("V75 validation failed: high-level interactiveMessage transport remains active.");
}

console.log("WhatsApp runtime V75 applied; required biz relay attributes + quality-control node + direct native-flow relay verified.");
