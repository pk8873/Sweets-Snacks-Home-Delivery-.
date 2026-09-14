import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_PAIRING_PATCH_V7";
if (source.includes(marker)) {
  console.log("WhatsApp pairing patch V7 already applied.");
  process.exit(0);
}

// V7 fixes the main Render failure: pairing must not depend on receiving a QR
// event first. On phone-number pairing, requestPairingCode() is retried until
// the socket is ready. This also makes a fresh code available after an old
// session was rejected with 401.
const trigger = '  sock.ev.on("creds.update", auth.saveCreds);';
if (!source.includes(trigger)) {
  throw new Error("Unable to locate Baileys socket setup for pairing V7.");
}

const pairingBlock = `  // ${marker}\n  const requestPairingCodeWithRetry = async () => {\n    if (auth.state.creds.registered || !pairingNumber || pairingRequested) return;\n\n    pairingRequested = true;\n    pairingAttempts += 1;\n\n    try {\n      await new Promise(resolve => setTimeout(resolve, 2500));\n      if (auth.state.creds.registered) {\n        pairingRequested = false;\n        return;\n      }\n\n      const code = await sock.requestPairingCode(pairingNumber);\n      const formatted = String(code).match(/.{1,4}/g)?.join("-") || code;\n\n      logger.info(\n        {\n          pairing_code: formatted,\n          pairing_attempt: pairingAttempts,\n          pairing_number_suffix: pairingNumber.slice(-4),\n          companion_platform_display: "Chrome (Windows)",\n        },\n        "WHATSAPP PAIRING CODE READY — enter this code in WhatsApp > Linked Devices > Link with phone number"\n      );\n    } catch (error) {\n      pairingRequested = false;\n      logger.error(\n        { error, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4) },\n        "WhatsApp pairing code request failed; retrying while the account is not registered"\n      );\n      setTimeout(requestPairingCodeWithRetry, 5000);\n    }\n  };\n\n  // Do not wait for a QR event. Phone-number pairing is its own flow.\n  if (!auth.state.creds.registered && pairingNumber) {\n    setTimeout(requestPairingCodeWithRetry, 1000);\n  }\n\n`;
source = source.replace(trigger, pairingBlock + trigger);

// Keep the existing V4 QR-triggered code as a harmless fallback, but allow it
// to run for a connecting socket as well. V7's retry helper normally wins first.
source = source.replace(
  'if (qr && !auth.state.creds.registered && pairingNumber && !pairingRequested) {',
  'if ((connection === "connecting" || qr) && !auth.state.creds.registered && pairingNumber && !pairingRequested) {'
);

// A 401 is treated as a stale/invalid session. The old code cleared the DB
// session and then returned, leaving the Node process alive with a dead socket.
// Exit cleanly so start_render.sh's supervisor starts a fresh socket and emits
// a new pairing code automatically.
const logoutPattern = /if \(code === DisconnectReason\.loggedOut\) \{[\s\S]*?logger\.error\("WhatsApp logged out\. Stored session was cleared; generate a new pairing code\."\);\s*return;\s*\}/;
if (!logoutPattern.test(source)) {
  throw new Error("Unable to locate WhatsApp logout recovery block for V7.");
}
source = source.replace(logoutPattern, `if (code === DisconnectReason.loggedOut) {\n        await auth.deleteSession();\n        logger.error("WhatsApp logged out. Stored session was cleared; restarting the bot to generate a new pairing code.");\n        process.exit(0);\n      }`);

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source);

console.log("WhatsApp pairing patch V7 applied: pairing-code retry + 401 logout recovery.");
