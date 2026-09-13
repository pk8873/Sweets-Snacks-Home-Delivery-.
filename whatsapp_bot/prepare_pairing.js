import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_PAIRING_PATCH_V3";
if (!source.includes(marker)) {
  const pattern = /async function connect\(\) \{[\s\S]*?\n\}\n\nhttp\.createServer/;
  const replacement = `// WHATSAPP_PAIRING_PATCH_V3
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
    // IMPORTANT: use a canonical WhatsApp Web browser identity.
    // Custom labels can make requestPairingCode() return a code that WhatsApp rejects.
    browser: Browsers.ubuntu("Chrome"),
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
        logger.info({ pairing_code: formatted, pairing_attempt: pairingAttempts }, "WhatsApp pairing code generated. Enter it in WhatsApp > Linked Devices > Link with phone number.");
      } catch (error) {
        pairingRequested = false;
        logger.error({ error, pairing_attempt: pairingAttempts }, "Unable to generate WhatsApp pairing code");
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
  fs.writeFileSync(file, patched);
  console.log("WhatsApp pairing-code patch V3 applied.");
} else {
  console.log("WhatsApp pairing-code patch V3 already applied.");
}
