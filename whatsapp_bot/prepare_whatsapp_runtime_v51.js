import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V51";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V51 already applied; nothing to do.");
  process.exit(0);
}

// V51 fixes the actual WhatsApp button rendering bug without changing the
// business handlers. The previous high-level interactiveMessage payload was
// rejected by the pinned Baileys fork with "Invalid media type". V51 builds
// the protobuf InteractiveMessage directly and relays it with the required
// bot + biz native-flow nodes.
//
// Do not depend on one exact import ordering: earlier runtime patches may have
// changed the Baileys named-import list. Preserve every existing named export
// and add only the two V51 dependencies when they are missing.
const importMatch = source.match(/import\s+makeWASocket,\s*\{([\s\S]*?)\}\s+from\s+["']@whiskeysockets\/baileys["'];/);
if (!importMatch) {
  throw new Error("V51 could not locate the Baileys import line.");
}
const existingImports = importMatch[1]
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);
for (const name of ["proto", "generateWAMessageFromContent"]) {
  if (!existingImports.includes(name)) existingImports.push(name);
}
const replacementImport = `import makeWASocket, { ${existingImports.join(", ")} } from "@whiskeysockets/baileys";`;
source = source.replace(importMatch[0], replacementImport);

const buttonsStart = source.indexOf("async function buttons(");
const listStart = source.indexOf("async function list(", buttonsStart);
const homeStart = source.indexOf("async function home(", listStart);
if (buttonsStart < 0 || listStart < 0 || homeStart < 0 || !(buttonsStart < listStart && listStart < homeStart)) {
  throw new Error("V51 could not locate buttons/list/home function boundaries.");
}

const newButtonsAndList = `function nativeFlowBizNode() {
  return {
    tag: "biz",
    attrs: {
      actual_actors: "2",
      host_storage: "2",
      privacy_mode_ts: String(Math.floor(Date.now() / 1000) - 77980457),
    },
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

async function relayNativeFlow(sock, jid, text, items, title = "") {
  const clean = items.filter(Boolean);
  if (!clean.length) return;

  const buttons = clean.map(x => proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
    name: String(x.name || "quick_reply"),
    buttonParamsJson: JSON.stringify(x.params || {}),
  }));

  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.create({
      text: String(text || ""),
    }),
    footer: proto.Message.InteractiveMessage.Footer.create({
      text: "Sweet & Snacks",
    }),
    ...(title ? {
      header: proto.Message.InteractiveMessage.Header.create({
        title: String(title).slice(0, 60),
        hasMediaAttachment: false,
      }),
    } : {}),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
      buttons,
      messageParamsJson: "{}",
      messageVersion: 1,
    }),
  });

  const userJid = sock.user?.id;
  if (!userJid) throw new Error("WhatsApp bot JID is not available for native-flow relay.");

  const waMessage = generateWAMessageFromContent(
    jid,
    { interactiveMessage },
    { userJid },
  );

  const botNode = { tag: "bot", attrs: { biz_bot: "1" } };
  const bizNode = nativeFlowBizNode();

  await sock.relayMessage(jid, waMessage.message, {
    messageId: waMessage.key.id,
    additionalNodes: [botNode, bizNode],
  });
}

async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  try {
    await relayNativeFlow(
      sock,
      jid,
      text,
      clean.map(x => ({
        name: "quick_reply",
        params: {
          display_text: String(x.text || "").slice(0, 20),
          id: String(x.id || "").slice(0, 200),
        },
      })),
    );
    logger.info({ event: "whatsapp.native_flow.sent", kind: "buttons", count: clean.length }, "Native Flow buttons sent");
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow button send failed");
    const fallback = [String(text || ""), "", clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n")].join("\\n");
    await sock.sendMessage(jid, { text: fallback });
  }
}

async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return;
  try {
    await relayNativeFlow(
      sock,
      jid,
      text,
      [{
        name: "single_select",
        params: {
          title: String(title || "Choose").slice(0, 24),
          sections: [{
            title: "Options",
            rows: clean.map(x => ({
              rowId: String(x.id || ""),
              id: String(x.id || ""),
              title: String(x.title || "").slice(0, 24),
              description: String(x.description || "").slice(0, 72),
            })),
          }],
        },
      }],
    );
    logger.info({ event: "whatsapp.native_flow.sent", kind: "single_select", count: clean.length }, "Native Flow list sent");
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow list send failed");
    const fallback = [String(text || ""), "", clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n")].join("\\n");
    await sock.sendMessage(jid, { text: fallback });
  }
}

`;

source = source.slice(0, buttonsStart) + newButtonsAndList + source.slice(homeStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V51 applied; low-level Native Flow protobuf relay + biz nodes + syntax check passed.");
