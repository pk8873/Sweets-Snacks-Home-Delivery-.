import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V58";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V58 already applied; nothing to do.");
  process.exit(0);
}

if (!source.includes("WHATSAPP_RUNTIME_FIX_V57") || !source.includes("async function relayNativeFlow")) {
  throw new Error("V58 requires the V57 Native Flow transport to be present.");
}

function replaceBetween(startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`V58 could not locate ${label}`);
  }
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceBetween(
  "function patchInteractiveMessageForMd(message)",
  "async function relayNativeFlow",
  `function patchInteractiveMessageForMd(message) {
  if (!message || typeof message !== "object") return message;
  if (message.viewOnceMessage?.message?.interactiveMessage) return message;
  if (message.interactiveMessage) {
    return {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: message.interactiveMessage,
        },
      },
    };
  }
  return message;
}

`,
  "verified viewOnceMessage wrapper"
);

replaceBetween(
  "async function buttons(sock, jid, text, items)",
  "async function list(sock, jid, text, rows, title = \"Choose\")",
  `async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  if (!clean.length) return;

  try {
    await relayNativeFlow(sock, jid, {
      interactiveMessage: proto.Message.InteractiveMessage.create({
        body: proto.Message.InteractiveMessage.Body.create({
          text: String(text || ""),
        }),
        footer: proto.Message.InteractiveMessage.Footer.create({
          text: "Sweet & Snacks",
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons: clean.map(x => proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
            name: "quick_reply",
            buttonParamsJson: JSON.stringify({
              display_text: String(x.text || "").slice(0, 20),
              id: String(x.id || "").slice(0, 200),
            }),
          })),
          messageParamsJson: "{}",
          messageVersion: 1,
        }),
      }),
    });
    logger.info({ event: "whatsapp.native_flow.sent", kind: "quick_reply", count: clean.length }, "WhatsApp quick-reply buttons sent");
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow button send failed");
    const fallback = [
      String(text || ""),
      "",
      clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n"),
    ].join("\\n");
    await sock.sendMessage(jid, { text: fallback });
  }
}

`,
  "buttons()"
);

replaceBetween(
  "async function list(sock, jid, text, rows, title = \"Choose\")",
  "async function home(sock, jid)",
  `async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return;

  try {
    await relayNativeFlow(sock, jid, {
      interactiveMessage: proto.Message.InteractiveMessage.create({
        body: proto.Message.InteractiveMessage.Body.create({
          text: String(text || ""),
        }),
        footer: proto.Message.InteractiveMessage.Footer.create({
          text: "Sweet & Snacks",
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons: [proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
            name: "single_select",
            buttonParamsJson: JSON.stringify({
              title: String(title || "Choose").slice(0, 24),
              sections: [{
                title: "Options",
                rows: clean.map(x => ({
                  header: "",
                  title: String(x.title || "").slice(0, 24),
                  description: String(x.description || "").slice(0, 72),
                  id: String(x.id || ""),
                })),
              }],
            }),
          })],
          messageParamsJson: "{}",
          messageVersion: 1,
        }),
      }),
    });
    logger.info({ event: "whatsapp.native_flow.sent", kind: "single_select", count: clean.length }, "WhatsApp single-select list sent");
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow list send failed");
    const fallback = [
      String(text || ""),
      "",
      clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n"),
    ].join("\\n");
    await sock.sendMessage(jid, { text: fallback });
  }
}

`,
  "list()"
);

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V58 applied; verified viewOnce Native Flow + messageVersion=1 + single-select transport passed.");
