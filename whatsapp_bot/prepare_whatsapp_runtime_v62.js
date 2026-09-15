import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V62";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V62 already applied; syntax check passed.");
  process.exit(0);
}

const trigger = "    activeSocket = sock;\n    sock.ev.on(\"creds.update\", auth.saveCreds);";
if (!source.includes(trigger)) {
  throw new Error("V62 could not locate persistent WhatsApp socket setup.");
}

const pairingBlock = `    activeSocket = sock;\n\n    // V62: phone-number pairing is requested only for a completely new session.\n    // Once creds.registered becomes true, Render restarts reuse the PostgreSQL\n    // auth state and MUST NOT ask for a new pairing code or disconnect the phone.\n    const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\\D/g, "");\n    let pairingCodeRequested = false;\n    const requestPairingCodeOnce = async () => {\n      if (pairingCodeRequested || auth.state.creds.registered || !pairingNumber) return;\n      pairingCodeRequested = true;\n      try {\n        await new Promise((resolve) => setTimeout(resolve, 3000));\n        if (auth.state.creds.registered) {\n          logger.info({ registered: true }, "WhatsApp existing session found; pairing code is not required");\n          return;\n        }\n        const code = await sock.requestPairingCode(pairingNumber);\n        const formatted = String(code).match(/.{1,4}/g)?.join("-") || String(code);\n        logger.info({ pairing_code: formatted, pairing_number_suffix: pairingNumber.slice(-4) }, "WHATSAPP PAIRING CODE READY — enter this code in WhatsApp > Linked Devices > Link with phone number");\n      } catch (error) {\n        pairingCodeRequested = false;\n        logger.error({ error: error?.message || error, pairing_number_suffix: pairingNumber.slice(-4) }, "WhatsApp pairing code request failed; retrying");\n        setTimeout(requestPairingCodeOnce, 5000);\n      }\n    };\n    if (auth.state.creds.registered) {\n      logger.info({ registered: true }, "WhatsApp session restored from PostgreSQL; no pairing code requested");\n    } else if (pairingNumber) {\n      setTimeout(requestPairingCodeOnce, 1000);\n    } else {\n      logger.warn("WhatsApp session is not registered and WHATSAPP_PHONE_NUMBER is not configured; pairing code cannot be requested");\n    }\n\n    sock.ev.on("creds.update", auth.saveCreds);`;

source = source.replace(trigger, pairingBlock);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const required of [
  "WHATSAPP_RUNTIME_FIX_V62",
  "WHATSAPP_PHONE_NUMBER",
  "WhatsApp session restored from PostgreSQL; no pairing code requested",
  "WHATSAPP PAIRING CODE READY",
]) {
  if (!finalSource.includes(required)) throw new Error(`V62 validation failed: missing ${required}`);
}

console.log("WhatsApp runtime V62 applied; one-time pairing persistence + pairing-code diagnostics + syntax validation passed.");
