import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V64";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V64 already applied; syntax check passed.");
  process.exit(0);
}

// V64 fixes the Render failure where the normal Baileys content path rejects
// interactiveMessage as an unsupported media type. zqbaileys_helper uses the
// low-level relay path and injects the required WhatsApp native-flow nodes.
// Only the button/list transport is replaced; all business logic and action
// IDs remain unchanged.
const importNeedle = 'import qrcode from "qrcode-terminal";';
if (!source.includes(importNeedle)) {
  throw new Error("V64 could not locate the qrcode import boundary.");
}
source = source.replace(
  importNeedle,
  `${importNeedle}\nimport baileysHelper from "zqbaileys_helper";\nconst { sendInteractiveMessage } = baileysHelper;`
);

const startToken = "async function buttons(sock, jid, text, items)";
const endToken = "async function home(sock, jid)";
const start = source.indexOf(startToken);
const end = source.indexOf(endToken, start + startToken.length);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("V64 could not locate the current buttons/list transport block.");
}

const replacement = `async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  if (!clean.length) return;
  const interactiveButtons = clean.map((x) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.text || "").slice(0, 20),
      id: String(x.id || "").slice(0, 200),
    }),
  }));
  try {
    await sendInteractiveMessage(sock, jid, {
      text: String(text || ""),
      footer: "Sweet & Snacks",
      interactiveButtons,
    });
    logger.info({ event: "whatsapp.native_flow.sent", kind: "quick_reply", button_count: interactiveButtons.length }, "WhatsApp interactive buttons sent");
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "WhatsApp interactive button send failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n"),
    });
  }
}

async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return;
  const interactiveButtons = [{
    name: "single_select",
    buttonParamsJson: JSON.stringify({
      title: String(title || "Choose").slice(0, 24),
      sections: [{
        title: "Options",
        rows: clean.map((x) => ({
          id: String(x.id || ""),
          title: String(x.title || "").slice(0, 24),
          description: String(x.description || "").slice(0, 72),
        })),
      }],
    }),
  }];
  try {
    await sendInteractiveMessage(sock, jid, {
      text: String(text || ""),
      footer: "Sweet & Snacks",
      interactiveButtons,
    });
    logger.info({ event: "whatsapp.native_flow.sent", kind: "single_select", row_count: clean.length }, "WhatsApp interactive list sent");
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "WhatsApp interactive list send failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n"),
    });
  }
}
`;

source = source.slice(0, start) + replacement + source.slice(end);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const required of [
  marker,
  'from "zqbaileys_helper"',
  "sendInteractiveMessage",
  "name: \"quick_reply\"",
  "name: \"single_select\"",
]) {
  if (!finalSource.includes(required)) {
    throw new Error(`V64 validation failed: missing ${required}`);
  }
}

if (finalSource.includes('sock.sendMessage(jid, { text, footer: "Sweet & Snacks", buttons:')) {
  throw new Error("V64 validation failed: legacy interactive button sender is still active.");
}

console.log("WhatsApp runtime V64 applied; helper-based interactive relay + list transport + syntax validation passed.");
