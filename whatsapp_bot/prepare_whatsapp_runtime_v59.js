import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V59";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V59 already applied; nothing to do.");
  process.exit(0);
}

if (!source.includes("WHATSAPP_RUNTIME_FIX_V58") || !source.includes("async function relayNativeFlow")) {
  throw new Error("V59 requires the V58 Native Flow transport to be present.");
}

function replaceBetween(startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`V59 could not locate ${label}`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceBetween(
  "function patchInteractiveMessageForMd(message)",
  "async function relayNativeFlow",
  `function patchInteractiveMessageForMd(message) {
  // WhatsApp Web/Desktop does not reliably render Native Flow when it is
  // wrapped in viewOnceMessage. Keep the interactiveMessage at the top level.
  return message;
}

`,
  "interactive transport wrapper"
);

replaceBetween(
  "async function list(sock, jid, text, rows, title = \"Choose\")",
  "async function home(sock, jid)",
  `async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return;
  try {
    await sock.sendMessage(jid, {
      title: "🍬 Sweet & Snacks",
      text: String(text || ""),
      footer: "Sweet & Snacks",
      buttonText: String(title || "Choose"),
      sections: [{
        title: "Options",
        rows: clean.map(x => ({
          rowId: String(x.id || ""),
          title: String(x.title || "").slice(0, 24),
          description: String(x.description || "").slice(0, 72),
        })),
      }],
    });
    logger.info({ event: "whatsapp.list.sent", count: clean.length }, "WhatsApp legacy list sent");
  } catch (error) {
    logger.error({ error: error?.message || error, stack: error?.stack }, "WhatsApp legacy list send failed");
    const fallback = [
      String(text || ""),
      "",
      clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n"),
    ].join("\\n");
    await sock.sendMessage(jid, { text: fallback });
  }
}
async function home(sock, jid)
`,
  "list()"
);

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V59 applied; removed viewOnce wrapper for Web/Desktop buttons and restored Web-compatible legacy list transport.");
