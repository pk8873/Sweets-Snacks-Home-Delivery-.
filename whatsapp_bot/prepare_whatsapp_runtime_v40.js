import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V40";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V40 already applied; nothing to do.");
  process.exit(0);
}

const connectStart = source.indexOf("async function connect()");
const httpStart = source.indexOf("http.createServer", connectStart);
if (connectStart < 0 || httpStart < 0) {
  throw new Error("V40 could not locate connect() or HTTP server block.");
}

const cleanConnect = String.raw`async function connect() {
  if (!pool) {
    throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");
  }

  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
  const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");

  if (!auth.state.creds.registered && !pairingNumber) {
    throw new Error("WHATSAPP_PHONE_NUMBER is required for first-time WhatsApp pairing.");
  }
  if (pairingNumber && (pairingNumber.length < 10 || pairingNumber.length > 15)) {
    throw new Error("WHATSAPP_PHONE_NUMBER must contain 10-15 digits with country code, without + or spaces.");
  }

  let pairingInFlight = false;
  let pairingAttempts = 0;
  let reconnectScheduled = false;
  let pairingTimer = null;

  const { version, isLatest } = await fetchLatestWaWebVersion({});
  logger.info({ wa_web_version: version, is_latest: isLatest }, "Using current WhatsApp Web version for pairing");

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
    if (auth.state.creds.registered || !pairingNumber || pairingInFlight) return;

    pairingInFlight = true;
    pairingAttempts += 1;
    const attempt = pairingAttempts;

    try {
      // Do not race WhatsApp's companion registration handshake. Concurrent
      // requestPairingCode() calls can corrupt pairing state and trigger 429.
      await new Promise(resolve => setTimeout(resolve, 12_000));
      if (auth.state.creds.registered) return;

      const code = await sock.requestPairingCode(pairingNumber);
      const formatted = String(code).match(/.{1,4}/g)?.join("-") || String(code);
      logger.info({
        pairing_code: formatted,
        pairing_attempt: attempt,
        pairing_number_suffix: pairingNumber.slice(-4),
      }, "WHATSAPP PAIRING CODE READY — enter it in WhatsApp > Linked Devices > Link with phone number");
    } catch (error) {
      const statusCode = new Boom(error)?.output?.statusCode || null;
      logger.error({
        error: error?.message || error,
        status_code: statusCode,
        pairing_attempt: attempt,
        pairing_number_suffix: pairingNumber.slice(-4),
      }, "WhatsApp pairing request failed; only one controlled retry will be scheduled");

      if (!auth.state.creds.registered && attempt < 3) {
        clearTimeout(pairingTimer);
        const delay = statusCode === 429 ? 90_000 : 30_000;
        pairingTimer = setTimeout(() => {
          pairingTimer = null;
          pairingInFlight = false;
          requestPairingCodeOnce().catch(retryError => {
            logger.error({ error: retryError?.message || retryError }, "Controlled WhatsApp pairing retry failed");
          });
        }, delay);
        return;
      }
    } finally {
      if (!pairingTimer) pairingInFlight = false;
    }
  };

  const schedulePairing = () => {
    if (auth.state.creds.registered || !pairingNumber || pairingInFlight || pairingTimer) return;
    pairingTimer = setTimeout(() => {
      pairingTimer = null;
      requestPairingCodeOnce().catch(error => {
        logger.error({ error: error?.message || error }, "WhatsApp pairing request crashed");
      });
    }, 1_000);
  };

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null;
    logger.info({
      event: "whatsapp.connection.update",
      connection,
      has_qr: Boolean(qr),
      registered: Boolean(auth.state.creds.registered),
      status_code: statusCode,
    }, "WhatsApp connection state changed");

    if (qr && auth.state.creds.registered === false && !pairingNumber) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "connecting" && !auth.state.creds.registered) {
      schedulePairing();
    }

    if (connection === "open") {
      clearTimeout(pairingTimer);
      pairingTimer = null;
      pairingInFlight = false;
      logger.info("✅ WhatsApp bot connected.");
    }

    if (connection === "close") {
      clearTimeout(pairingTimer);
      pairingTimer = null;
      pairingInFlight = false;
      const message = lastDisconnect?.error?.message || "Unknown connection failure";
      logger.error({ status_code: statusCode, last_disconnect: message }, "WhatsApp connection closed");

      if (statusCode === DisconnectReason.loggedOut) {
        await auth.deleteSession();
        logger.error("WhatsApp logged out. Stored session was cleared; restarting the bot to generate a new pairing code.");
        process.exit(0);
      }

      if (!reconnectScheduled) {
        reconnectScheduled = true;
        setTimeout(() => {
          connect().catch(error => logger.error({ error: error?.message || error }, "WhatsApp reconnect failed"));
        }, 5_000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    logger.info({ event: "whatsapp.messages.upsert", type, count: messages?.length || 0 }, "WhatsApp messages.upsert received");
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
        }, "WhatsApp incoming message");
        if (rawMessage?.interactiveResponseMessage) {
          logger.info({ interactive_response: rawMessage.interactiveResponseMessage }, "WhatsApp raw interactive response");
        }
        await handle(sock, m);
      } catch (error) {
        logger.error({ error: error?.message || error, message_key: m?.key }, "WhatsApp message handler failed");
      }
    }
  });
}

`;

source = source.slice(0, connectStart) + cleanConnect + source.slice(httpStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V40 applied; single pairing flow + 429 backoff + event diagnostics + syntax check passed.");
