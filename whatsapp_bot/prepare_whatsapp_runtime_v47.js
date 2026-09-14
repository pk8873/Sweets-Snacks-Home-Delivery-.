import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V47";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V47 already applied; nothing to do.");
  process.exit(0);
}

if (!source.includes("WHATSAPP_RUNTIME_FIX_V46")) {
  throw new Error("V47 requires the V46 WhatsApp runtime baseline.");
}

const oldBlock = `    if (qr && !auth.state.creds.registered) {\n      qrSeen = true;\n      logger.info("WhatsApp initial registration/QR handshake received; pairing-code request can now be scheduled.");\n      schedulePairingCode();\n    }`;

const newBlock = `    if (qr && !auth.state.creds.registered) {\n      qrSeen = true;\n      logger.info("WhatsApp initial registration/QR handshake received; QR fallback is available if pairing-code registration is rate-limited.");\n      try {\n        qrcode.generate(qr, { small: true });\n        logger.info("WHATSAPP QR READY — scan this QR from WhatsApp > Linked devices > Link a device.");\n      } catch (error) {\n        logger.error({ error: error?.message || error }, "Unable to render WhatsApp QR fallback");\n      }\n      schedulePairingCode();\n    }`;

if (!source.includes(oldBlock)) {
  throw new Error("V47 could not locate the V46 QR handshake block.");
}

source = source.replace(oldBlock, newBlock);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V47 applied; QR fallback is now printed when pairing-code registration is rate-limited + syntax check passed.");
