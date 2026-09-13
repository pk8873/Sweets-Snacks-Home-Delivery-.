import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

if (!source.includes("WHATSAPP_PAIRING_PATCH_V1")) {
  const pattern = /async function connect\(\) \{[\s\S]*?\n\}\n\nhttp\.createServer/;
  const replacement = `// WHATSAPP_PAIRING_PATCH_V1
async function connect() {
  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");

  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
  const sock = makeWASocket({
    auth: auth.state,
    browser: Browsers.ubuntu("Sweet & Snacks"),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", auth.saveCreds);

  const pairingNumber = (process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\\D/g, "");
  if (!auth.state.creds.registered && pairingNumber) {
    if (pairingNumber.length < 10 || pairingNumber.length > 15) {
      throw new Error("WHATSAPP_PHONE_NUMBER must contain 10-15 digits with country code.");
    }
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        logger.info({ pairing_code: code }, "WhatsApp pairing code generated. Enter this code in WhatsApp > Linked Devices > Link with phone number.");
      } catch (error) {
        logger.error({ error }, "Unable to generate WhatsApp pairing code");
      }
    }, 3000);
  }

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr && !pairingNumber) qrcode.generate(qr, { small: true });
    if (connection === "open") logger.info("✅ WhatsApp bot connected.");
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => connect().catch(e => logger.error({ e }, "Reconnect failed")), 3000);
      } else {
        await auth.deleteSession();
        logger.error("WhatsApp logged out. Stored session was cleared; scan a new QR or use phone-number pairing.");
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
  console.log("WhatsApp pairing-code patch applied.");
} else {
  console.log("WhatsApp pairing-code patch already applied.");
}
