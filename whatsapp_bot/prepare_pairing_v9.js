import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_FORCE_PAIRING_V9";
if (source.includes(marker)) {
  console.log("WhatsApp pairing V9 already applied.");
  process.exit(0);
}

// V9 is an optional, one-time recovery switch for a stored WhatsApp session.
// Set WHATSAPP_FORCE_PAIRING=1 in Render only when a fresh phone-number
// pairing code is required. The marker file prevents the supervisor restart
// from deleting the newly cleared session repeatedly.
const trigger = '  sock.ev.on("creds.update", auth.saveCreds);';
if (!source.includes(trigger)) {
  throw new Error("Unable to locate WhatsApp socket setup for pairing V9.");
}

const block = `  // ${marker}\n  if (String(process.env.WHATSAPP_FORCE_PAIRING || "").trim() === "1") {\n    const forcePairingMarker = "/tmp/whatsapp-force-pairing-once";\n    if (!fs.existsSync(forcePairingMarker)) {\n      if (!pairingNumber) {\n        logger.error("WHATSAPP_FORCE_PAIRING=1 is enabled, but WHATSAPP_PAIRING_NUMBER is missing. Set the pairing phone number in Render environment variables.");\n      } else if (auth.state.creds.registered) {\n        await auth.deleteSession();\n        fs.writeFileSync(forcePairingMarker, String(Date.now()));\n        logger.warn("WhatsApp stored session cleared for one-time phone-number pairing. Restarting to generate a fresh pairing code.");\n        process.exit(0);\n      }\n    }\n  }\n\n`;

source = source.replace(trigger, block + trigger);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

console.log("WhatsApp pairing V9 applied: optional one-time force re-pair + fresh phone pairing code.");
