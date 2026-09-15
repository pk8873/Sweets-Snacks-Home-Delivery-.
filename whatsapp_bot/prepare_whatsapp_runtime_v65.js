import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V65";
let source = fs.readFileSync(file, "utf8");

function assertContains(value, label) {
  if (!source.includes(value)) throw new Error(`V65 validation failed: missing ${label}`);
}

// V65 is intentionally narrow: it finalizes and validates the interactive
// transport introduced by V64. It does not touch any Django, Telegram,
// product, cart, order, payment, delivery, customer, or business logic.

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  const helperModule = await import("zqbaileys_helper");
  const helper = helperModule?.default || helperModule;
  if (typeof helper?.sendInteractiveMessage !== "function") {
    throw new Error("V65 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");
  }
  assertContains("sendInteractiveMessage", "helper transport");
  assertContains('name: "quick_reply"', "quick_reply transport");
  assertContains('name: "single_select"', "single_select transport");
  console.log("WhatsApp runtime V65 already applied; helper export + transport + syntax validation passed.");
  process.exit(0);
}

if (!source.includes("zqbaileys_helper")) {
  const importNeedle = 'import qrcode from "qrcode-terminal";';
  if (!source.includes(importNeedle)) throw new Error("V65 could not locate qrcode import boundary.");
  source = source.replace(
    importNeedle,
    `${importNeedle}\nimport baileysHelper from "zqbaileys_helper";\nconst { sendInteractiveMessage } = baileysHelper;`
  );
}

if (!source.includes("sendInteractiveMessage")) {
  throw new Error("V65 could not enable zqbaileys_helper interactive transport.");
}

// If V64 already installed the helper transport, keep it. Otherwise replace
// only the buttons/list transport with the helper transport.
if (!source.includes("WHATSAPP_RUNTIME_FIX_V64")) {
  const startToken = "async function buttons(sock, jid, text, items)";
  const endToken = "async function home(sock, jid)";
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("V65 could not locate the current buttons/list transport block.");
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
    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n") });
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
    await sock.sendMessage(jid, { text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n") });
  }
}
`;

  source = source.slice(0, start) + replacement + source.slice(end);
}

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

// Verify the actual installed helper export before the bot starts. This turns
// a dependency mismatch into a clear startup error instead of a silent button
// failure after the greeting has already been sent.
const helperModule = await import("zqbaileys_helper");
const helper = helperModule?.default || helperModule;
if (typeof helper?.sendInteractiveMessage !== "function") {
  throw new Error("V65 validation failed: zqbaileys_helper.sendInteractiveMessage is unavailable.");
}

assertContains(marker, "V65 marker");
assertContains("sendInteractiveMessage", "helper transport");
assertContains('name: "quick_reply"', "quick_reply transport");
assertContains('name: "single_select"', "single_select transport");
if (source.includes('sock.sendMessage(jid, { text, footer: "Sweet & Snacks", buttons:')) {
  throw new Error("V65 validation failed: legacy WhatsApp buttons sender is still active.");
}

console.log("WhatsApp runtime V65 applied; helper-based interactive transport + dependency validation + syntax check passed.");
