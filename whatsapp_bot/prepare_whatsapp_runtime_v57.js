import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V57";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V57 already applied; nothing to do.");
  process.exit(0);
}

if (!source.includes("WHATSAPP_RUNTIME_FIX_V55") || !source.includes("async function relayNativeFlow")) {
  throw new Error("V57 requires the V55 Native Flow transport to be present.");
}

const bizStart = source.indexOf("function nativeFlowBizNode(");
const relayStart = source.indexOf("async function relayNativeFlow", bizStart);
const buttonsStart = source.indexOf("async function buttons", relayStart);
if (bizStart < 0 || relayStart < 0 || buttonsStart < 0 || !(bizStart < relayStart && relayStart < buttonsStart)) {
  throw new Error("V57 could not locate V55 transport boundaries.");
}

const transport = `function nativeFlowBizNode(message) {
  const nativeFlow = message?.interactiveMessage?.nativeFlowMessage;
  const firstButtonName = nativeFlow?.buttons?.[0]?.name;
  const baseAttrs = {
    actual_actors: "2",
    host_storage: "2",
    privacy_mode_ts: String(Math.floor(Date.now() / 1000) - 77980457),
  };

  if (nativeFlow && (firstButtonName === "review_and_pay" || firstButtonName === "payment_info")) {
    return {
      tag: "biz",
      attrs: {
        ...baseAttrs,
        native_flow_name: firstButtonName === "review_and_pay" ? "order_details" : firstButtonName,
      },
    };
  }

  if (nativeFlow) {
    return {
      tag: "biz",
      attrs: baseAttrs,
      content: [
        {
          tag: "interactive",
          attrs: { type: "native_flow", v: "1" },
          content: [
            {
              tag: "native_flow",
              attrs: { v: "9", name: "mixed" },
            },
          ],
        },
        {
          tag: "quality_control",
          attrs: { source_type: "third_party" },
        },
      ],
    };
  }

  if (message?.listMessage) {
    return {
      tag: "biz",
      attrs: baseAttrs,
      content: [{
        tag: "list",
        attrs: { v: "2", type: "product_list" },
      }],
    };
  }

  return { tag: "biz", attrs: baseAttrs };
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
  const relayMessage = patchInteractiveMessageForMd(normalized);
  const bizNode = nativeFlowBizNode(normalized);
  const additionalNodes = [bizNode];

  if (!jid.endsWith("@g.us")) {
    additionalNodes.push({ tag: "bot", attrs: { biz_bot: "1" } });
  }

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
`;

source = source.slice(0, bizStart) + transport + source.slice(buttonsStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V57 applied; required native-flow biz attributes + relay validation passed.");
