import fs from "node:fs";

const path = "whatsapp_bot/index.js";
const marker = "WHATSAPP_RUNTIME_FIX_V24";

let src = fs.readFileSync(path, "utf8");
if (src.includes(marker)) {
  console.log("WhatsApp runtime fix V24 already applied; nothing to do.");
  process.exit(0);
}

const importLine = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion } from "@whiskeysockets/baileys";';
const importReplacement = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, proto, generateWAMessageFromContent } from "@whiskeysockets/baileys";';
if (!src.includes(importLine)) {
  throw new Error("Unable to find Baileys import for V24.");
}
src = src.replace(importLine, importReplacement);

const buttonsPattern = /async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}(?=async function list)/;
const buttonsReplacement = [
  "async function buttons(sock, jid, text, items) {",
  "  const clean = items.filter(Boolean).slice(0, 3);",
  "  if (!clean.length) return;",
  "",
  "  try {",
  "    const interactiveMessage = proto.Message.InteractiveMessage.create({",
  "      body: proto.Message.InteractiveMessage.Body.create({",
  "        text: String(text || \"\")",
  "      }),",
  "      footer: proto.Message.InteractiveMessage.Footer.create({",
  "        text: \"Sweet & Snacks\"",
  "      }),",
  "      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({",
  "        buttons: clean.map((x) => proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({",
  "          name: \"quick_reply\",",
  "          buttonParamsJson: JSON.stringify({",
  "            display_text: String(x.text || \"\").slice(0, 20),",
  "            id: String(x.id || \"\").slice(0, 200)",
  "          })",
  "        })),",
  "        messageParamsJson: \"{}\",",
  "        messageVersion: 1",
  "      })",
  "    });",
  "",
  "    const waMessage = generateWAMessageFromContent(",
  "      jid,",
  "      { interactiveMessage },",
  "      { userJid: sock.user?.id || jid }",
  "    );",
  "",
  "    const bizNode = {",
  "      tag: \"biz\",",
  "      attrs: {",
  "        actual_actors: \"2\",",
  "        host_storage: \"2\",",
  "        privacy_mode_ts: String(Math.floor(Date.now() / 1000) - 77980457)",
  "      },",
  "      content: [",
  "        {",
  "          tag: \"interactive\",",
  "          attrs: { type: \"native_flow\", v: \"1\" },",
  "          content: [{ tag: \"native_flow\", attrs: { v: \"9\", name: \"mixed\" } }]",
  "        },",
  "        { tag: \"quality_control\", attrs: { source_type: \"third_party\" } }",
  "      ]",
  "    };",
  "    const botNode = { tag: \"bot\", attrs: { biz_bot: \"1\" } };",
  "    const additionalNodes = String(jid).endsWith(\"@g.us\") ? [bizNode] : [botNode, bizNode];",
  "",
  "    await sock.relayMessage(jid, waMessage.message, {",
  "      messageId: waMessage.key.id,",
  "      additionalNodes",
  "    });",
  "  } catch (error) {",
  "    logger.error({ error: error?.message || error }, \"Native Flow button relay failed\");",
  "    await sock.sendMessage(jid, {",
  "      text: String(text || \"\") + \"\\n\\n\" + clean.map((x, i) => String(i + 1) + \". \" + String(x.text || \"\")).join(\"\\n\")",
  "    });",
  "  }",
  "}"
].join("\n");

if (!buttonsPattern.test(src)) {
  throw new Error("Unable to replace WhatsApp buttons() for V24.");
}
src = src.replace(buttonsPattern, buttonsReplacement);

const listPattern = /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}(?=async function home)/;
const listReplacement = [
  "async function list(sock, jid, text, rows, title = \"Choose\") {",
  "  const clean = rows.filter(Boolean).slice(0, 10);",
  "  if (!clean.length) return;",
  "",
  "  try {",
  "    const params = {",
  "      title: String(title || \"Choose\").slice(0, 24),",
  "      sections: [{",
  "        title: \"Options\",",
  "        rows: clean.map((x) => ({",
  "          id: String(x.id || \"\").slice(0, 200),",
  "          title: String(x.title || \"\").slice(0, 24),",
  "          description: String(x.description || \"\").slice(0, 72)",
  "        }))",
  "      }]",
  "    };",
  "",
  "    const interactiveMessage = proto.Message.InteractiveMessage.create({",
  "      body: proto.Message.InteractiveMessage.Body.create({",
  "        text: String(text || \"\")",
  "      }),",
  "      footer: proto.Message.InteractiveMessage.Footer.create({",
  "        text: \"Sweet & Snacks\"",
  "      }),",
  "      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({",
  "        buttons: [proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({",
  "          name: \"single_select\",",
  "          buttonParamsJson: JSON.stringify(params)",
  "        })],",
  "        messageParamsJson: \"{}\",",
  "        messageVersion: 1",
  "      })",
  "    });",
  "",
  "    const waMessage = generateWAMessageFromContent(",
  "      jid,",
  "      { interactiveMessage },",
  "      { userJid: sock.user?.id || jid }",
  "    );",
  "",
  "    const bizNode = {",
  "      tag: \"biz\",",
  "      attrs: {",
  "        actual_actors: \"2\",",
  "        host_storage: \"2\",",
  "        privacy_mode_ts: String(Math.floor(Date.now() / 1000) - 77980457)",
  "      },",
  "      content: [",
  "        {",
  "          tag: \"interactive\",",
  "          attrs: { type: \"native_flow\", v: \"1\" },",
  "          content: [{ tag: \"native_flow\", attrs: { v: \"9\", name: \"mixed\" } }]",
  "        },",
  "        { tag: \"quality_control\", attrs: { source_type: \"third_party\" } }",
  "      ]",
  "    };",
  "    const botNode = { tag: \"bot\", attrs: { biz_bot: \"1\" } };",
  "    const additionalNodes = String(jid).endsWith(\"@g.us\") ? [bizNode] : [botNode, bizNode];",
  "",
  "    await sock.relayMessage(jid, waMessage.message, {",
  "      messageId: waMessage.key.id,",
  "      additionalNodes",
  "    });",
  "  } catch (error) {",
  "    logger.error({ error: error?.message || error }, \"Native Flow list relay failed\");",
  "    await sock.sendMessage(jid, {",
  "      text: String(text || \"\") + \"\\n\\n\" + clean.map((x, i) => String(i + 1) + \". \" + String(x.title || \"\")).join(\"\\n\")",
  "    });",
  "  }",
  "}"
].join("\n");

if (!listPattern.test(src)) {
  throw new Error("Unable to replace WhatsApp list() for V24.");
}
src = src.replace(listPattern, listReplacement);

src = src.replace(/\n\/\/ WHATSAPP_RUNTIME_FIX_V23[\s\S]*?\n/, "\n");
src = src.replace(/\n$/, "") + `\n\n// ${marker}\n`;

fs.writeFileSync(path, src, "utf8");
console.log("WhatsApp runtime fix V24 applied; low-level Native Flow relay + single-select list + syntax patch installed.");
