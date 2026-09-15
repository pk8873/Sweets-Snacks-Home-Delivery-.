import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_PAIRING_RELIABILITY_V13";
if (source.includes(marker)) {
  console.log("WhatsApp pairing reliability V13 already applied.");
  process.exit(0);
}

const pattern = /async function connect\(\) \{[\s\S]*?\n\}\n\nhttp\.createServer/;
if (!pattern.test(source)) {
  throw new Error("Unable to locate WhatsApp connect() block for pairing V13.");
}

const replacement = `// ${marker}
async function connect() {
  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");

  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
  const pairingNumber = (process.env.WHATSAPP_PHONE_NUMBER || process.env.WHATSAPP_PAIRING_NUMBER || "").replace(/\\D/g, "");

  if (!auth.state.creds.registered && !pairingNumber) {
    throw new Error("WHATSAPP_PHONE_NUMBER is required for first-time WhatsApp pairing.");
  }

  if (pairingNumber && (pairingNumber.length < 10 || pairingNumber.length > 15)) {
    throw new Error("WHATSAPP_PHONE_NUMBER must contain 10-15 digits with country code, without + or spaces.");
  }

  // One-time forced re-pair. This is the safe way to recover when the stored
  // WhatsApp device session is disconnected/rejected and the user needs a new
  // phone-number pairing code. The /tmp marker prevents repeated session wipes
  // during the supervisor restart loop.
  if (String(process.env.WHATSAPP_NEW_PAIRING || "").trim() === "1") {
    const freshPairingMarker = "/tmp/whatsapp-new-pairing-v13";
    if (!fs.existsSync(freshPairingMarker) && auth.state.creds.registered) {
      await auth.deleteSession();
      fs.writeFileSync(freshPairingMarker, String(Date.now()), "utf8");
      logger.warn("WhatsApp stored session cleared for one-time fresh phone pairing; restarting now to generate a new pairing code.");
      process.exit(0);
    }
  }

  let pairingRequested = false;
  let pairingAttempts = 0;
  let closed = false;
  let reconnectScheduled = false;

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

  const reconnect = (delayMs, reason) => {
    if (closed && !reconnectScheduled) {
      reconnectScheduled = true;
      logger.warn({ delay_ms: delayMs, reason }, "WhatsApp pairing reconnect scheduled");
      setTimeout(() => connect().catch(error => logger.error({ error }, "WhatsApp reconnect failed")), delayMs);
    }
  };

  const requestPairingCodeWithRetry = async () => {
    if (closed || auth.state.creds.registered || !pairingNumber || pairingRequested) return;

    pairingRequested = true;
    pairingAttempts += 1;

    try {
      // requestPairingCode() must run after the socket reports connecting/QR state.
      // The delay avoids racing the initial WebSocket handshake on Render.
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (closed || auth.state.creds.registered) {
        pairingRequested = false;
        return;
      }

      const code = await sock.requestPairingCode(pairingNumber);
      const formatted = String(code).match(/.{1,4}/g)?.join("-") || code;

      logger.info(
        {
          pairing_code: formatted,
          pairing_attempt: pairingAttempts,
          pairing_number_suffix: pairingNumber.slice(-4),
          companion_platform_display: "Chrome (Windows)",
        },
        "WHATSAPP PAIRING CODE READY — enter this code in WhatsApp > Linked Devices > Link with phone number"
      );
    } catch (error) {
      pairingRequested = false;
      if (!closed && !auth.state.creds.registered) {
        logger.error(
          { error, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4) },
          "WhatsApp pairing code request failed; retrying on the same socket"
        );
        setTimeout(() => requestPairingCodeWithRetry().catch(() => {}), 3000);
      }
    }
  };

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    const code = new Boom(lastDisconnect?.error)?.output?.statusCode;

    logger.info(
      {
        connection,
        registered: Boolean(auth.state.creds.registered),
        has_qr: Boolean(qr),
        status_code: code,
      },
      "WhatsApp pairing connection update"
    );

    if (!auth.state.creds.registered && pairingNumber && (connection === "connecting" || qr)) {
      await requestPairingCodeWithRetry();
    }

    if (connection === "open") {
      pairingRequested = false;
      logger.info("✅ WhatsApp bot connected.");
    }

    if (connection !== "close") return;

    closed = true;
    const message = lastDisconnect?.error?.message || "Unknown connection failure";
    logger.error(
      { status_code: code, last_disconnect: message, registered: Boolean(auth.state.creds.registered) },
      "WhatsApp connection closed"
    );

    if (code === DisconnectReason.loggedOut) {
      await auth.deleteSession();
      logger.error("WhatsApp logged out. Stored session was cleared; restarting to generate a new pairing code.");
      process.exit(0);
    }

    // 515 is a normal restart-required step after successful phone pairing.
    // Keep the credentials and reconnect instead of stopping the pairing flow.
    if (code === DisconnectReason.restartRequired) {
      reconnect(2000, "restart_required_515");
      return;
    }

    // A 401 before registration means the temporary pairing session is stale.
    // Delete only the unregistered session and restart so a fresh code is issued.
    if (code === DisconnectReason.badSession && !auth.state.creds.registered) {
      await auth.deleteSession();
      reconnect(2000, "pending_pairing_bad_session_401");
      return;
    }

    reconnect(3000, `disconnect_${code || "unknown"}`);
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) await handle(sock, m);
  });
}

http.createServer`;

source = source.replace(pattern, replacement);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

console.log("WhatsApp pairing reliability V13 applied: phone pairing waits for socket readiness, 515 reconnects, pending 401 gets a fresh code, QR is not displayed, and WHATSAPP_NEW_PAIRING supports one-time re-pairing.");
