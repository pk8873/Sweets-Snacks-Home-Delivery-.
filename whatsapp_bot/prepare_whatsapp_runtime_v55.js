import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V55";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V55 already applied; nothing to do.");
  process.exit(0);
}

// V55 is a WhatsApp transport-only correction. V51/V52 built the protobuf
// message correctly but did not apply the same MD compatibility wrapper and
// exact biz/bot relay-node order used by the proven WhiskeySockets helper.
// This patch mirrors that narrow transport behavior only. Business handlers,
// action IDs, Django API calls, cart/order logic, and session storage remain
// untouched.
if (!source.includes("WHATSAPP_RUNTIME_FIX_V51") || !source.includes("async function relayNativeFlow")) {
  throw new Error("V55 requires the V51 Native Flow relay to be present.");
}

const bizStart = source.indexOf("function nativeFlowBizNode()");
const relayStart = source.indexOf("async function relayNativeFlow", bizStart);
const buttonsStart = source.indexOf("async function buttons", relayStart);
const listStart = source.indexOf("async function list", buttonsStart);
const homeStart = source.indexOf("async function home", listStart);
if ([bizStart, relayStart, buttonsStart, listStart, homeStart].some(x => x < 0) || !(bizStart < relayStart && relayStart < buttonsStart && buttonsStart < listStart && listStart < homeStart)) {
  throw new Error("V55 could not locate Native Flow transport function boundaries.");
}

const transport = `function nativeFlowBizNode(message) {
  const nativeFlow = message?.interactiveMessage?.nativeFlowMessage;
  const firstButtonName = nativeFlow?.buttons?.[0]?.name;

  if (nativeFlow && (firstButtonName === "review_and_pay" || firstButtonName === "payment_info")) {
    return {
      tag: "biz",
      attrs: {
        native_flow_name: firstButtonName === "review_and_pay" ? "order_details" : firstButtonName,
      },
    };
  }

  if (nativeFlow) {
    return {
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
    };
  }

  if (message?.listMessage) {
    return {
      tag: "biz",
      attrs: {},
      content: [{
        tag: "list",
        attrs: { v: "2", type: "product_list" },
      }],
    };
  }

  return { tag: "biz", attrs: {} };
}

function patchInteractiveMessageForMd(message) {
  if (!message || typeof message !== "object") return message;
  if (message.documentWithCaptionMessage?.message) return message;
  if (message.buttonsMessage || message.listMessage || message.interactiveMessage) {
    return {
      documentWithCaptionMessage: {
        message: { ...message },
      },
    };
  }
  return message;
}

async function relayNativeFlow(sock, jid, content) {
  const userJid = sock.user?.id;
  if (!userJid) throw new Error("WhatsApp bot JID is not available for interactive relay.");

  const waMessage = generateWAMessageFromContent(
    jid,
    content,
    { userJid, timestamp: new Date() },
  );

  const normalized = waMessage.message;
  const bizNode = nativeFlowBizNode(normalized);
  const additionalNodes = [bizNode];

  // Private chats require the bot node for native-flow rendering.
  if (!jid.endsWith("@g.us")) {
    additionalNodes.push({ tag: "bot", attrs: { biz_bot: "1" } });
  }

  // This wrapper is important for the current multi-device message format.
  // It is the same compatibility patch used by the helper implementation.
  const relayMessage = patchInteractiveMessageForMd(normalized);
  waMessage.message = relayMessage;

  await sock.relayMessage(jid, relayMessage, {
    messageId: waMessage.key.id,
    additionalNodes,
  });

  logger.info({
    event: "whatsapp.native_flow.sent",
    message_type: normalized?.interactiveMessage?.nativeFlowMessage ? "native_flow" : (normalized?.listMessage ? "list" : "unknown"),
    private_chat: !jid.endsWith("@g.us"),
    message_id: waMessage.key.id,
  }, "WhatsApp interactive message relayed successfully");
}

async function buttons(sock, jid, text, items) {
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
        }),
      }),
    });
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow button send failed");
    const fallback = [
      String(text || ""),
      "",
      clean.map((x, i) => `${i + 1}. ${String(x.text || "")}`).join("\\n"),
    ].join("\\n");
    await sock.sendMessage(jid, { text: fallback });
  }
}

async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return;

  try {
    await relayNativeFlow(sock, jid, {
      listMessage: {
        title: String(title || "Choose").slice(0, 24),
        description: String(text || ""),
        buttonText: String(title || "Choose").slice(0, 24),
        listType: 1,
        sections: [{
          title: "Options",
          rows: clean.map(x => ({
            rowId: String(x.id || ""),
            title: String(x.title || "").slice(0, 24),
            description: String(x.description || "").slice(0, 72),
          })),
        }],
        footerText: "Sweet & Snacks",
      },
    });
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow list send failed");
    const fallback = [
      String(text || ""),
      "",
      clean.map((x, i) => `${i + 1}. ${String(x.title || "")}`).join("\\n"),
    ].join("\\n");
    await sock.sendMessage(jid, { text: fallback });
  }
}

`;

source = source.slice(0, bizStart) + transport + source.slice(homeStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V55 applied; MD-compatible Native Flow relay + exact biz/bot node order + syntax check passed.");
