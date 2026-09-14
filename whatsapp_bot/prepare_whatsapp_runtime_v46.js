import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V46";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V46 already applied; nothing to do.");
  process.exit(0);
}

if (!source.includes("WHATSAPP_RUNTIME_FIX_V44")) {
  throw new Error("V46 requires the V44 WhatsApp runtime baseline.");
}

const connectStart = source.indexOf("async function connect()");
const httpStart = source.indexOf("http.createServer", connectStart);
if (connectStart < 0 || httpStart < 0) {
  throw new Error("V46 could not locate connect() or HTTP server block.");
}

const helper = `
// V46: WhatsApp can rate-limit pairing-code registration for 15-40 minutes.
// Keep the cooldown at process level so a 429 close cannot create a 5-second
// reconnect/request loop and make the rate limit worse.
let whatsappPairingRateLimitedUntil = 0;
const WHATSAPP_PAIRING_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;
`;

if (!source.includes("whatsappPairingRateLimitedUntil")) {
  source = source.slice(0, connectStart) + helper + source.slice(connectStart);
}

const updatedConnectStart = source.indexOf("async function connect()");
const updatedHttpStart = source.indexOf("http.createServer", updatedConnectStart);

const cleanConnect = String.raw`async function connect() {
  if (!pool) {
    throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render.");
  }

  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
  const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");

  if (!pairingNumber) {
    throw new Error("WHATSAPP_PHONE_NUMBER is required. Set the WhatsApp number with country code, without + or spaces.");
  }
  if (pairingNumber.length < 10 || pairingNumber.length > 15) {
    throw new Error("WHATSAPP_PHONE_NUMBER must contain 10-15 digits with country code, without + or spaces.");
  }

  let pairingInFlight = false;
  let pairingRequested = false;
  let pairingTimer = null;
  let reconnectTimer = null;
  let qrSeen = false;
  let reconnectScheduled = false;

  const { version, isLatest } = await fetchLatestWaWebVersion({});
  logger.info({
    wa_web_version: version,
    is_latest: isLatest,
    pairing_mode: "code",
    phone_configured: true,
    registered: Boolean(auth.state.creds.registered),
  }, "Using WhatsApp Web version — PAIRING CODE MODE ONLY");

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
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 30_000,
  });

  sock.ev.on("creds.update", auth.saveCreds);

  const requestPairingCodeOnce = async () => {
    if (auth.state.creds.registered || pairingInFlight || pairingRequested) return;
    if (whatsappPairingRateLimitedUntil > Date.now()) {
      const waitMinutes = Math.ceil((whatsappPairingRateLimitedUntil - Date.now()) / 60_000);
      logger.warn({ wait_minutes: waitMinutes }, "WhatsApp pairing is in local cooldown after a previous 429; no new pairing request will be sent now.");
      return;
    }
    if (!qrSeen) {
      logger.info("WhatsApp pairing code request postponed until the initial QR/registration handshake is received.");
      return;
    }

    pairingInFlight = true;
    try {
      // One request per socket only. Concurrent/repeated pairing-code requests
      // can overwrite the pairing state needed to decrypt the later response.
      await new Promise(resolve => setTimeout(resolve, 1_500));
      if (auth.state.creds.registered || pairingRequested || !qrSeen) return;
      if (whatsappPairingRateLimitedUntil > Date.now()) return;

      const code = await sock.requestPairingCode(pairingNumber);
      const formatted = String(code).match(/.{1,4}/g)?.join("-") || String(code);
      pairingRequested = true;
      logger.info({
        pairing_code: formatted,
        pairing_number_suffix: pairingNumber.slice(-4),
      }, "WHATSAPP PAIRING CODE READY — enter this code in WhatsApp > Linked Devices > Link with phone number");
    } catch (error) {
      const statusCode = error ? new Boom(error).output?.statusCode || null : null;
      if (statusCode === 429 || /rate-overlimit/i.test(String(error?.message || error))) {
        whatsappPairingRateLimitedUntil = Date.now() + WHATSAPP_PAIRING_RATE_LIMIT_COOLDOWN_MS;
        logger.error({
          error: error?.message || error,
          status_code: 429,
          cooldown_minutes: 30,
          pairing_number_suffix: pairingNumber.slice(-4),
        }, "WhatsApp pairing endpoint returned 429 rate-overlimit; automatic pairing requests are paused for 30 minutes.");
      } else {
        logger.error({
          error: error?.message || error,
          status_code: statusCode,
          pairing_number_suffix: pairingNumber.slice(-4),
        }, "WhatsApp pairing code request failed");
      }
    } finally {
      pairingInFlight = false;
    }
  };

  const schedulePairingCode = () => {
    if (auth.state.creds.registered || pairingInFlight || pairingRequested || pairingTimer) return;
    if (whatsappPairingRateLimitedUntil > Date.now()) return;
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
      pairing_mode: "code",
    }, "WhatsApp connection state changed");

    if (qr && !auth.state.creds.registered) {
      qrSeen = true;
      logger.info("WhatsApp initial registration/QR handshake received; pairing-code request can now be scheduled.");
      schedulePairingCode();
    }

    if (connection === "open") {
      clearTimeout(pairingTimer);
      clearTimeout(reconnectTimer);
      pairingTimer = null;
      reconnectTimer = null;
      pairingInFlight = false;
      reconnectScheduled = false;
      whatsappPairingRateLimitedUntil = 0;
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

      if (!auth.state.creds.registered && (statusCode === 429 || /rate-overlimit/i.test(message))) {
        whatsappPairingRateLimitedUntil = Math.max(
          whatsappPairingRateLimitedUntil,
          Date.now() + WHATSAPP_PAIRING_RATE_LIMIT_COOLDOWN_MS,
        );
        logger.error({
          cooldown_minutes: 30,
          retry_after: new Date(whatsappPairingRateLimitedUntil).toISOString(),
        }, "WhatsApp 429 cooldown active; reconnecting only after the cooldown instead of hammering the pairing endpoint.");
        if (!reconnectScheduled) {
          reconnectScheduled = true;
          reconnectTimer = setTimeout(() => {
            reconnectScheduled = false;
            reconnectTimer = null;
            connect().catch(error => logger.error({ error: error?.message || error }, "WhatsApp cooldown reconnect failed"));
          }, Math.max(whatsappPairingRateLimitedUntil - Date.now(), 1_000));
        }
        return;
      }

      const delay = statusCode === 515 ? 15_000 : 5_000;
      if (!reconnectScheduled) {
        reconnectScheduled = true;
        reconnectTimer = setTimeout(() => {
          reconnectScheduled = false;
          reconnectTimer = null;
          connect().catch(error => logger.error({ error: error?.message || error }, "WhatsApp reconnect failed"));
        }, delay);
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

source = source.slice(0, updatedConnectStart) + cleanConnect + source.slice(updatedHttpStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V46 applied; QR-handshake gated pairing + 429 cooldown + reconnect protection + diagnostics + syntax check passed.");
