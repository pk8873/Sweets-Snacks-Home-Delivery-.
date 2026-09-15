import {
  generateWAMessageFromContent,
  normalizeMessageContent,
  generateMessageIDV2,
  isJidGroup,
} from "@whiskeysockets/baileys";

function toQuickReplyButtons(items, labelKey = "text") {
  return items.filter(Boolean).map((item, index) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(item?.[labelKey] || `Option ${index + 1}`).slice(0, 20),
      id: String(item?.id || `option_${index + 1}`).slice(0, 200),
    }),
  }));
}

function interactiveNode() {
  return {
    tag: "biz",
    attrs: {},
    content: [
      {
        tag: "interactive",
        attrs: {
          type: "native_flow",
          v: "1",
        },
        content: [
          {
            tag: "native_flow",
            attrs: {
              v: "9",
              name: "mixed",
            },
          },
        ],
      },
    ],
  };
}

export async function sendNativeFlowButtons(sock, jid, text, items, labelKey = "text") {
  const buttons = toQuickReplyButtons(items, labelKey);
  if (!buttons.length) return;

  const userJid = sock.user?.id || sock.authState?.creds?.me?.id;
  const message = {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
    },
    interactiveMessage: {
      body: { text: String(text || "") },
      footer: { text: "Sweet & Snacks" },
      nativeFlowMessage: {
        buttons,
        messageParamsJson: "",
      },
    },
  };

  const fullMsg = generateWAMessageFromContent(jid, message, {
    userJid,
    messageId: generateMessageIDV2(userJid),
    timestamp: new Date(),
    logger: sock.logger,
  });

  const normalized = normalizeMessageContent(fullMsg.message);
  if (!normalized?.interactiveMessage?.nativeFlowMessage) {
    throw new Error("Native Flow message construction failed");
  }

  const additionalNodes = [interactiveNode()];
  if (!isJidGroup(jid)) {
    additionalNodes.push({ tag: "bot", attrs: { biz_bot: "1" } });
  }

  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalNodes,
  });

  return fullMsg;
}
