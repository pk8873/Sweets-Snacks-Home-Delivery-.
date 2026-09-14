import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V48";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V48 already applied; nothing to do.");
  process.exit(0);
}

if (!source.includes("WHATSAPP_RUNTIME_FIX_V47")) {
  throw new Error("V48 requires the V47 WhatsApp runtime baseline.");
}

// V48: pairing-code-only means the terminal must never render or advertise
// a QR fallback. The QR event is still used internally by Baileys as the
// registration handshake that makes requestPairingCode() safe to call.
const qrFallbackBlock = `    if (qr && !auth.state.creds.registered) {\n      qrSeen = true;\n      logger.info("WhatsApp initial registration/QR handshake received; QR fallback is available if pairing-code registration is rate-limited.");\n      try {\n        qrcode.generate(qr, { small: true });\n        logger.info("WHATSAPP QR READY — scan this QR from WhatsApp > Linked devices > Link a device.");\n      } catch (error) {\n        logger.error({ error: error?.message || error }, "Unable to render WhatsApp QR fallback");\n      }\n      schedulePairingCode();\n    }`;

const pairingOnlyBlock = `    if (qr && !auth.state.creds.registered) {\n      qrSeen = true;\n      logger.info("WhatsApp registration handshake received; pairing-code mode remains active and no QR will be displayed.");\n      schedulePairingCode();\n    }`;

if (!source.includes(qrFallbackBlock)) {
  throw new Error("V48 could not locate the V47 QR fallback block.");
}

source = source.replace(qrFallbackBlock, pairingOnlyBlock);
source = source.replace(/import qrcode from "qrcode-terminal";\n/, "");
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V48 applied; pairing-code-only mode enforced, QR output removed, syntax check passed.");
