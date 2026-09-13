import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const pairingMarker = "WHATSAPP_PAIRING_PATCH_V4";
if (!source.includes(pairingMarker)) {
  const pattern = /async function connect\(\) \{[\s\S]*?\n\}\n\nhttp\.createServer/;
  const replacement = `// WHATSAPP_PAIRING_PATCH_V4
async function connect() {
  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");

  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
  const pairingNumber = (process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\\D/g, "");

  if (!auth.state.creds.registered && !pairingNumber) {
    throw new Error("WHATSAPP_PHONE_NUMBER is required for first-time WhatsApp pairing.");
  }

  if (pairingNumber && (pairingNumber.length < 10 || pairingNumber.length > 15)) {
    throw new Error("WHATSAPP_PHONE_NUMBER must contain 10-15 digits with country code, without + or spaces.");
  }

  let pairingRequested = false;
  let pairingAttempts = 0;
  let reconnecting = false;

  const { version, isLatest } = await fetchLatestWaWebVersion({});
  logger.info({ wa_web_version: version, is_latest: isLatest }, "Using current WhatsApp Web version for pairing");

  const sock = makeWASocket({
    auth: auth.state,
    version,
    browser: Browsers.windows("Chrome"),
    companionPlatformDisplay: "Chrome (Windows)",
    countryCode: "IN",
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 20_000,
  });

  sock.ev.on("creds.update", auth.saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !auth.state.creds.registered && pairingNumber && !pairingRequested) {
      pairingRequested = true;
      pairingAttempts += 1;
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        const formatted = String(code).match(/.{1,4}/g)?.join("-") || code;
        logger.info(
          {
            pairing_code: formatted,
            pairing_attempt: pairingAttempts,
            pairing_number_suffix: pairingNumber.slice(-4),
            companion_platform_display: "Chrome (Windows)",
          },
          "WhatsApp pairing code accepted by server. Enter it in WhatsApp > Linked Devices > Link with phone number."
        );
      } catch (error) {
        pairingRequested = false;
        logger.error(
          { error, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4) },
          "WhatsApp pairing request was rejected or timed out; no unusable pairing code was issued"
        );
      }
    } else if (qr && !pairingNumber) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      logger.info("✅ WhatsApp bot connected.");
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const message = lastDisconnect?.error?.message || "Unknown connection failure";
      logger.error({ status_code: code, last_disconnect: message }, "WhatsApp connection closed");

      if (code === DisconnectReason.loggedOut) {
        await auth.deleteSession();
        logger.error("WhatsApp logged out. Stored session was cleared; generate a new pairing code.");
        return;
      }

      if (!auth.state.creds.registered && pairingRequested) {
        logger.error("Initial WhatsApp pairing connection closed; waiting for a fresh deployment/restart instead of replacing the pending pairing state.");
        return;
      }

      if (!reconnecting) {
        reconnecting = true;
        setTimeout(() => connect().catch(e => logger.error({ e }, "Reconnect failed")), 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) await handle(sock, m);
  });
}

http.createServer`;

  const patched = source.replace(pattern, replacement);
  if (patched === source) throw new Error("Unable to locate WhatsApp connect() block for pairing patch.");
  source = patched;
  console.log("WhatsApp pairing-code patch V4 applied.");
} else {
  console.log("WhatsApp pairing-code patch V4 already applied.");
}

// V5: reply to greetings before contacting Django so a temporary API/database
// problem cannot make the bot appear completely silent to a new customer.
const greetingMarker = "WHATSAPP_GREETING_FAST_PATH_V5";
if (!source.includes(greetingMarker)) {
  const greetingPattern = /const name = m\.pushName \|\| "Customer", s = state\(jid, name\), lower = text\.toLowerCase\(\)\.trim\(\);\n  try \{\n    await getCustomer\(payload\(jid, name\)\);/;
  const greetingReplacement = `const name = m.pushName || "Customer", s = state(jid, name), lower = text.toLowerCase().trim();
  try {
    if (greeting.test(lower)) return home(sock, jid);
    await getCustomer(payload(jid, name));`;
  const patchedGreeting = source.replace(greetingPattern, greetingReplacement);
  if (patchedGreeting === source) throw new Error("Unable to add WhatsApp greeting fast-path. Expected handle() source was not found.");
  source = `// ${greetingMarker}\n${patchedGreeting}`;
  fs.writeFileSync(file, source);
  console.log("WhatsApp greeting fast-path patch V5 applied.");
} else {
  console.log("WhatsApp greeting fast-path patch V5 already applied.");
}

// V6: WhatsApp clients can encode button/list replies in several protobuf
// shapes. Normalize all known reply forms to the same internal action ID.
const actionMarker = "WHATSAPP_ACTION_PARSER_V6";
if (!source.includes(actionMarker)) {
  const actionPattern = /const actionOf = \(m\) => \{[\s\S]*?\};\nconst incomingLocation/;
  const actionReplacement = `const actionOf = (m) => {
  const x = unwrap(m?.message);
  const direct = [
    x.buttonsResponseMessage?.selectedButtonId,
    x.listResponseMessage?.singleSelectReply?.selectedRowId,
    x.templateButtonReplyMessage?.selectedId,
    x.hydratedTemplateButtonReplyMessage?.hydratedButtonId,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.buttonParamsJson,
    x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson,
  ];

  const findId = (value) => {
    if (!value) return "";
    if (typeof value === "string") {
      try { return findId(JSON.parse(value)); } catch { return value; }
    }
    if (typeof value !== "object") return "";
    const keys = ["id", "button_id", "row_id", "selected_id", "selectedButtonId", "selectedRowId"];
    for (const key of keys) if (typeof value[key] === "string" && value[key]) return value[key];
    for (const valuePart of Object.values(value)) {
      const found = findId(valuePart);
      if (found) return found;
    }
    return "";
  };

  for (const candidate of direct) {
    const id = findId(candidate);
    if (id) return id;
  }
  return "";
};
const incomingLocation`;
  const patchedActions = source.replace(actionPattern, actionReplacement);
  if (patchedActions === source) throw new Error("Unable to add WhatsApp action parser V6. Expected actionOf source was not found.");
  source = patchedActions;
}

// V6 also makes the displayed reply text available when WhatsApp sends a
// template/interactive response without selectedDisplayText.
const textMarker = "WHATSAPP_TEXT_PARSER_V6";
if (!source.includes(textMarker)) {
  const textPattern = /const textOf = \(m\) => \{[\s\S]*?\};\nconst actionOf/;
  const textReplacement = `const textOf = (m) => {
  const x = unwrap(m?.message);
  return String(
    x.conversation ||
    x.extendedTextMessage?.text ||
    x.imageMessage?.caption ||
    x.videoMessage?.caption ||
    x.documentMessage?.caption ||
    x.buttonsResponseMessage?.selectedDisplayText ||
    x.listResponseMessage?.title ||
    x.templateButtonReplyMessage?.selectedDisplayText ||
    x.hydratedTemplateButtonReplyMessage?.selectedDisplayText ||
    x.interactiveResponseMessage?.body?.text ||
    ""
  ).trim();
};
const actionOf`;
  const patchedText = source.replace(textPattern, textReplacement);
  if (patchedText === source) throw new Error("Unable to add WhatsApp text parser V6. Expected textOf source was not found.");
  source = patchedText;
}

fs.writeFileSync(file, source);
console.log("WhatsApp pairing/button compatibility patches V4/V5/V6 applied.");
