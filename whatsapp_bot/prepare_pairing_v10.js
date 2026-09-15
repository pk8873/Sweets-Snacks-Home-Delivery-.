import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_NEW_PAIRING_V10";
if (source.includes(marker)) {
  console.log("WhatsApp pairing V10 already applied.");
  process.exit(0);
}

// V10 adds an explicit one-time fresh pairing switch.
// Set WHATSAPP_NEW_PAIRING=1 in Render when the current stored WhatsApp
// session must be cleared and a new phone-number pairing code generated.
// The /tmp marker prevents the supervisor restart from clearing the session
// again during the same deployment.
const trigger = '  sock.ev.on("creds.update", auth.saveCreds);';
if (!source.includes(trigger)) {
  throw new Error("Unable to locate WhatsApp socket setup for pairing V10.");
}

const block = `  // ${marker}\n  if (String(process.env.WHATSAPP_NEW_PAIRING || "").trim() === "1") {\n    const freshPairingMarker = "/tmp/whatsapp-new-pairing-v10";\n    if (!fs.existsSync(freshPairingMarker)) {\n      if (!pairingNumber) {\n        logger.error("WHATSAPP_NEW_PAIRING=1 is enabled, but WHATSAPP_PAIRING_NUMBER is missing.");\n      } else if (auth.state.creds.registered) {\n        await auth.deleteSession();\n        fs.writeFileSync(freshPairingMarker, String(Date.now()));\n        logger.warn("WhatsApp stored session cleared for one-time fresh phone pairing. Restarting now to generate a new pairing code.");\n        process.exit(0);\n      }\n    }\n  }\n\n`;

source = source.replace(trigger, block + trigger);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

console.log("WhatsApp pairing V10 applied: explicit one-time fresh pairing switch enabled.");
