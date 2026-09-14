import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V43";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V43 already applied; nothing to do.");
  process.exit(0);
}

const connectStart = source.indexOf("async function connect()");
const httpStart = source.indexOf("http.createServer", connectStart);
if (connectStart < 0 || httpStart < 0) {
  throw new Error("V43 could not locate connect() or HTTP server block.");
}

const cleanConnect = String.raw`async function connect() {
  if (!pool) {
    throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render.");
  }

  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
  const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
  const pairingMode = "code";

  if (!pairingNumber) {
    throw new Error("WHATSAPP_PHONE_NUMBER is required. Set the WhatsApp number with country code, without + or spaces.");
  }
  if (pairingNumber.length < 10 || pairingNumber.length > 15) {
    throw new Error("WHATSAPP_PHONE_NUMBER must contain 10-15 digits with country code, without + or spaces.");
  }

  let pairingInFlight = false;
  let pairingRequested = false;
  let pairingTimer = null;
  let reconnectScheduled = false;

  const { version, isLatest } = await fetchLatestWaWebVersion({});
  logger.info({
    wa_web_version: version,
    is_latest: isLatest,
    pairing_mode: pairingMode,
    phone_configured: Boolean(pairingNumber),
    registered: Boolean(auth.state.creds.registered),
  }, "Using WhatsApp Web version — PAIRING CODE MODE ONLY");

  const sock = makeWASocket({
    auth: auth.state,
    version,
    browser: Browsers.macOS("Chrome"),
    countryCode: "IN",
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 20_000,
  });

  sock.ev.on("creds.update", auth.saveCreds);

  const requestPairingCodeOnce = async () => {
    if (auth.state.creds.registered || pairingInFlight || pairingRequested) return;

    pairingInFlight = true;
    try {
      // Wait for the initial WhatsApp registration handshake. Only one request
      // is made per socket to avoid 429 rate limits and duplicate pairing flows.
      await new Promise(resolve => setTimeout(resolve, 8_000));
      if (auth.state.creds.registered || pairingRequested) return;

      const code = await sock.requestPairingCode(pairingNumber);
      const formatted = String(code).match(/.{1,4}/g)?.join("-") || String(code);
      pairingRequested = true;
      logger.info({
        pairing_code: formatted,
        pairing_number_suffix: pairingNumber.slice(-4),
      }, "WHATSAPP PAIRING CODE READY — enter this code in WhatsApp > Linked Devices > Link with phone number");
    } catch (error) {
      const statusCode = error ? new Boom(error).output?.statusCode || null : null;
      logger.error({
        error: error?.message || error,
        status_code: statusCode,
        pairing_number_suffix: pairingNumber.slice(-4),
      }, statusCode === 429
        ? "WhatsApp pairing endpoint returned 429; this socket will not retry automatically. Restart the service only after the rate limit clears."
        : "WhatsApp pairing code request failed");
    } finally {
      pairingInFlight = false;
    }
  };

  const schedulePairingCode = () => {
    if (auth.state.creds.registered || pairingInFlight || pairingRequested || pairingTimer) return;
    pairingTimer = setTimeout(() => {
      pairingTimer = null;
      requestPairingCodeOnce().catch(error => {
        logger.error({ error: error?.message || error }, "WhatsApp pairing code request failed safely");
      });
    }, 1_500);
  };

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error).output?.statusCode || null : null;

    logger.info({
      event: "whatsapp.connection.update",
      connection,
      has_qr: Boolean(qr),
      registered: Boolean(auth.state.creds.registered),
      status_code: statusCode,
      pairing_mode: pairingMode,
    }, "WhatsApp connection state changed");

    // QR is intentionally ignored. This bot is pairing-code only.
    if (qr && !auth.state.creds.registered) {
      logger.info("WhatsApp QR received but intentionally ignored because pairing-code mode is enabled.");
    }

    if (connection === "connecting" && !auth.state.creds.registered) {
      schedulePairingCode();
    }

    if (connection === "open") {
      clearTimeout(pairingTimer);
      pairingTimer = null;
      pairingInFlight = false;
      reconnectScheduled = false;
      logger.info("✅ WhatsApp bot connected.");
    }

    if (connection === "close") {
      clearTimeout(pairingTimer);
      pairingTimer = null;
      pairingInFlight = false;

      const message = lastDisconnect?.error?.message || "Unknown connection failure";
      logger.error({
        status_code: statusCode,
        last_disconnect: message,
        registered: Boolean(auth.state.creds.registered),
      }, "WhatsApp connection closed");

      if (statusCode === DisconnectReason.loggedOut) {
        await auth.deleteSession();
        logger.error("WhatsApp logged out. Stored session was cleared; restarting the bot to generate a new pairing-code registration.");
        process.exit(0);
      }

      if (!reconnectScheduled) {
        reconnectScheduled = true;
        setTimeout(() => {
          reconnectScheduled = false;
          connect().catch(error => logger.error({ error: error?.message || error }, "WhatsApp reconnect failed"));
        }, 5_000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    logger.info({
      event: "whatsapp.messages.upsert",
      type,
      count: messages?.length || 0,
    }, "WhatsApp messages.upsert received");

    for (const m of messages || []) {
      try {
        const rawMessage = unwrap(m?.message);
        const action = actionOf(m);
        const text = textOf(m);
        logger.info({
          event: "whatsapp.incoming",
          remote_jid: m?.key?.remoteJid,
          from_me: Boolean(m?.key?.fromMe),
          message_type: Object.keys(rawMessage || {}),
          action,
          text,
          has_interactive_response: Boolean(rawMessage?.interactiveResponseMessage),
          has_buttons_response: Boolean(rawMessage?.buttonsResponseMessage),
          has_list_response: Boolean(rawMessage?.listResponseMessage),
        }, "WhatsApp incoming message");

        if (rawMessage?.interactiveResponseMessage) {
          logger.info({
            interactive_response: rawMessage.interactiveResponseMessage,
          }, "WhatsApp raw interactive response");
        }

        await handle(sock, m);
      } catch (error) {
        logger.error({
          error: error?.message || error,
          message_key: m?.key,
        }, "WhatsApp message handler failed");
      }
    }
  });
}

`;

source = source.slice(0, connectStart) + cleanConnect + source.slice(httpStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V43 applied; pairing-code only + QR ignored + single request per socket + reconnect safety + diagnostics + syntax check passed.");
