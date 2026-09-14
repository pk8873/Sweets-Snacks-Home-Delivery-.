import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V27";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V27 already applied; nothing to do.");
  process.exit(0);
}

function replaceFunction(sourceText, startToken, endToken, replacement, name) {
  const start = sourceText.indexOf(startToken);
  if (start < 0) throw new Error(`V27 could not locate ${name} start.`);
  const end = sourceText.indexOf(endToken, start + startToken.length);
  if (end < 0) throw new Error(`V27 could not locate ${name} end.`);
  return sourceText.slice(0, start) + replacement + sourceText.slice(end);
}

const oldImport = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion } from "@whiskeysockets/baileys";';
const newImport = 'import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, proto, generateWAMessageFromContent } from "@whiskeysockets/baileys";';
if (source.includes(oldImport)) source = source.replace(oldImport, newImport);
if (!source.includes("generateWAMessageFromContent") || !source.includes("proto")) {
  throw new Error("V27 could not install the required Baileys Native Flow imports.");
}

const buttonsReplacement = `async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  if (!clean.length) return;

  try {
    const interactiveMessage = proto.Message.InteractiveMessage.create({
      body: proto.Message.InteractiveMessage.Body.create({
        text: String(text || "")
      }),
      footer: proto.Message.InteractiveMessage.Footer.create({
        text: "Sweet & Snacks"
      }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: clean.map((x) => proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
          name: "quick_reply",
          buttonParamsJson: JSON.stringify({
            display_text: String(x.text || "").slice(0, 20),
            id: String(x.id || "").slice(0, 200)
          })
        })),
        messageParamsJson: "{}",
        messageVersion: 1
      })
    });

    const waMessage = generateWAMessageFromContent(
      jid,
      { interactiveMessage },
      { userJid: sock.user?.id || jid }
    );

    const botNode = { tag: "bot", attrs: { biz_bot: "1" } };
    const bizNode = {
      tag: "biz",
      attrs: {
        actual_actors: "2",
        host_storage: "2",
        privacy_mode_ts: String(Math.floor(Date.now() / 1000) - 77980457)
      },
      content: [
        {
          tag: "interactive",
          attrs: { type: "native_flow", v: "1" },
          content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }]
        },
        { tag: "quality_control", attrs: { source_type: "third_party" } }
      ]
    };

    const additionalNodes = String(jid).endsWith("@g.us") ? [bizNode] : [botNode, bizNode];
    await sock.relayMessage(jid, waMessage.message, {
      messageId: waMessage.key.id,
      additionalNodes
    });
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow button relay failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.text || "")).join("\\n")
    });
  }
}
`;

source = replaceFunction(
  source,
  "async function buttons(sock, jid, text, items)",
  "async function list(sock, jid, text, rows, title = \"Choose\")",
  buttonsReplacement,
  "buttons()"
);

const listReplacement = `async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  if (!clean.length) return sock.sendMessage(jid, { text: String(text || "") });

  try {
    const params = {
      title: String(title || "Choose").slice(0, 24),
      sections: [{
        title: "Options",
        rows: clean.map((x) => ({
          id: String(x.id || "").slice(0, 200),
          title: String(x.title || "").slice(0, 24),
          description: String(x.description || "").slice(0, 72)
        }))
      }]
    };

    const interactiveMessage = proto.Message.InteractiveMessage.create({
      body: proto.Message.InteractiveMessage.Body.create({
        text: String(text || "")
      }),
      footer: proto.Message.InteractiveMessage.Footer.create({
        text: "Sweet & Snacks"
      }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: [proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create({
          name: "single_select",
          buttonParamsJson: JSON.stringify(params)
        })],
        messageParamsJson: "{}",
        messageVersion: 1
      })
    });

    const waMessage = generateWAMessageFromContent(
      jid,
      { interactiveMessage },
      { userJid: sock.user?.id || jid }
    );

    const botNode = { tag: "bot", attrs: { biz_bot: "1" } };
    const bizNode = {
      tag: "biz",
      attrs: {
        actual_actors: "2",
        host_storage: "2",
        privacy_mode_ts: String(Math.floor(Date.now() / 1000) - 77980457)
      },
      content: [
        {
          tag: "interactive",
          attrs: { type: "native_flow", v: "1" },
          content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }]
        },
        { tag: "quality_control", attrs: { source_type: "third_party" } }
      ]
    };

    const additionalNodes = String(jid).endsWith("@g.us") ? [bizNode] : [botNode, bizNode];
    await sock.relayMessage(jid, waMessage.message, {
      messageId: waMessage.key.id,
      additionalNodes
    });
  } catch (error) {
    logger.error({ error: error?.message || error }, "Native Flow list relay failed");
    await sock.sendMessage(jid, {
      text: String(text || "") + "\\n\\n" + clean.map((x, i) => String(i + 1) + ". " + String(x.title || "")).join("\\n")
    });
  }
}
`;

source = replaceFunction(
  source,
  "async function list(sock, jid, text, rows, title = \"Choose\")",
  "async function home(sock, jid)",
  listReplacement,
  "list()"
);

// V26's database-pool protection is retained here so V27 does not depend on V24/V25/V26.
const oldPool = 'const pool = WHATSAPP_DATABASE_URL ? new Pool({ connectionString: WHATSAPP_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;';
const newPool = 'const pool = WHATSAPP_DATABASE_URL ? new Pool({ connectionString: WHATSAPP_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 }) : null;';
if (source.includes(oldPool)) source = source.replace(oldPool, newPool);

// V26's weight-selection fix is applied only when the old one-line handler is still present.
const oldWeight = 'if (action.startsWith("weight_")) { const parts = action.split("_"); s.weight = Number(parts[2]); const r = await getProduct(Number(parts[1])); return product(sock, jid, r.product); }';
const newWeight = `if (action.startsWith("weight_")) {
      const parts = action.split("_");
      const productId = Number(parts[1]);
      const selectedWeight = Number(parts[2]);
      if (!Number.isFinite(productId) || !Number.isFinite(selectedWeight) || selectedWeight <= 0) return home(sock, jid);
      const r = await getProduct(productId);
      const p = r.product;
      if (!p) return home(sock, jid);
      s.product = p;
      s.weight = selectedWeight;
      s.qty = Math.max(Number(s.qty || 1), 1);
      s.step = "product";
      const f = await getFavorites(payload(jid, s.name));
      s.favorite = f.products.some(x => x.id === p.id);
      const base = \`🍬 *\${p.name}*\\n\\n\${p.description || "Freshly prepared and carefully packed."}\\n\\n💰 \${money(p.price)} / \${p.price_quantity_label}\\n⚖️ Weight: *\${labelWeight(selectedWeight)}*\\n📦 \${p.stock_display}\\n❤️ Favorite: \${s.favorite ? "Yes" : "No"}\`;
      return productActions(sock, jid, p, base);
    }`;
if (source.includes(oldWeight)) source = source.replace(oldWeight, newWeight);

source = source.replace(/\n$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V27 applied; robust Native Flow relay + single-select + DB pool protection + syntax check passed.");
