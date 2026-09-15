import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V50";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V50 already applied; nothing to do.");
  process.exit(0);
}

// V50 fixes the reconnect lifecycle without deleting the existing WhatsApp
// credentials. In particular, Baileys status 515 means the socket must be
// recreated; it is not a logout and must never clear the PostgreSQL auth state.
// Also prevent overlapping connect() calls, which can create competing sockets
// and make an otherwise valid linked device appear to disconnect repeatedly.
const connectStart = source.indexOf("async function connect() {");
const httpStart = source.indexOf("http.createServer(", connectStart);
if (connectStart < 0 || httpStart < 0 || httpStart <= connectStart) {
  throw new Error("V50 could not locate the WhatsApp connect() block.");
}

const newConnectBlock = `let activeSocket = null;
let reconnectTimer = null;
let reconnecting = false;
let reconnectDelayMs = 3000;

const scheduleReconnect = (reason, delay = reconnectDelayMs) => {
  if (reconnectTimer || reconnecting) return;
  const wait = Math.max(1000, Math.min(Number(delay) || 3000, 30000));
  logger.warn({ reason, retry_in_ms: wait }, "WhatsApp reconnect scheduled without clearing session");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(error => logger.error({ error }, "WhatsApp reconnect failed"));
  }, wait);
  reconnectDelayMs = Math.min(Math.max(reconnectDelayMs * 2, 3000), 30000);
};

async function connect() {
  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");
  if (reconnecting) return;
  reconnecting = true;

  try {
    const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
    const sock = makeWASocket({
      auth: auth.state,
      browser: Browsers.ubuntu("Sweet & Snacks"),
      logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    activeSocket = sock;

    sock.ev.on("creds.update", auth.saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      const code = connection === "close" ? new Boom(lastDisconnect?.error)?.output?.statusCode : null;
      logger.info({
        event: "whatsapp.connection.update",
        connection,
        has_qr: Boolean(qr),
        registered: Boolean(auth.state.creds.registered),
        status_code: code,
      }, "WhatsApp connection state changed");

      if (connection === "open") {
        reconnectDelayMs = 3000;
        logger.info("WhatsApp bot connected — existing session preserved.");
        return;
      }

      if (connection !== "close") return;
      if (activeSocket === sock) activeSocket = null;

      // 515 is the normal "restart required" event after phone-number pairing.
      // Recreate the socket, but KEEP the credentials in PostgreSQL. Do not
      // call deleteSession() and do not terminate the Node process.
      if (code === 515) {
        logger.warn({ status_code: code }, "WhatsApp requested a socket restart (515); preserving the linked session");
        return scheduleReconnect("baileys_515_restart_required", 1500);
      }

      // 401 can mean the remote session was invalidated. Never erase the local
      // credentials automatically: doing so causes an endless re-pair loop on
      // Render. Stop automatic reconnect for this socket and leave the stored
      // session intact for deliberate recovery.
      if (code === 401) {
        logger.error({ status_code: code }, "WhatsApp returned 401; session was NOT deleted and automatic re-pairing was NOT triggered");
        return;
      }

      if (code === DisconnectReason.loggedOut) {
        // This is a genuine logout. Preserve the database record here as well;
        // the owner can explicitly relink later instead of Render repeatedly
        // deleting and recreating the session.
        logger.error({ status_code: code }, "WhatsApp logged out remotely; stored session was NOT deleted automatically");
        return;
      }

      scheduleReconnect(\`status_\${code || "unknown"}\`);
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      logger.info({
        event: "whatsapp.messages.upsert",
        type,
        count: messages?.length || 0,
      }, "WhatsApp messages.upsert received");

      for (const m of messages || []) {
        try {
          await handle(sock, m);
        } catch (error) {
          logger.error({
            error: error?.message || error,
            message_key: m?.key,
          }, "WhatsApp message handler failed");
        }
      }
    });
  } finally {
    reconnecting = false;
  }
}

`;

source = source.slice(0, connectStart) + newConnectBlock + source.slice(httpStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V50 applied; session-preserving 515 reconnect + single-socket guard + no automatic auth deletion + syntax check passed.");
