import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_PAIRING_CODE_ONLY_V11";
if (source.includes(marker)) {
  console.log("WhatsApp pairing-code-only patch V11 already applied.");
  process.exit(0);
}

// Pairing-code-only scope: do not change buttons, lists, product flow,
// cart/order logic, Django integration, or interactive-message handling.
// Only make the phone-number pairing lifecycle reliable on Render.

// Remove the terminal QR dependency/display left by older pairing patches.
source = source.replace(/import qrcode from \"qrcode-terminal\";\r?\n?/g, "");
source = source.replace(/\s*else if \(qr && !pairingNumber\) \{\s*qrcode\.generate\(qr, \{ small: true \}\);\s*\}/g, "");
source = source.replace(/qrcode\.generate\([^;]+;?/g, "");

// Make sure the V7 retry helper is not blocked by a stale pairingRequested
// flag after a pairing socket closes/restarts.
const staleClose = /if \(!auth\.state\.creds\.registered && pairingRequested\) \{[\s\S]*?return;\s*\}/;
if (staleClose.test(source)) {
  source = source.replace(staleClose, `if (!auth.state.creds.registered && pairingRequested) {
        pairingRequested = false;
        logger.warn("Initial phone pairing connection closed before registration; restarting the socket for a fresh pairing-code attempt.");
        if (!reconnecting) {
          reconnecting = true;
          setTimeout(() => connect().catch(e => logger.error({ e }, "Pairing reconnect failed")), 5000);
        }
        return;
      }`);
}

// If V7 is present, keep its independent retry helper. If an older source does
// not contain it, add a minimal phone-number-only retry helper after the socket
// setup trigger. This branch does not touch message/button handlers.
if (!source.includes("requestPairingCodeWithRetry")) {
  const trigger = '  sock.ev.on("creds.update", auth.saveCreds);';
  if (!source.includes(trigger)) {
    throw new Error("Unable to locate WhatsApp socket setup for pairing V11.");
  }
  const block = `  // ${marker}
  const requestPairingCodeWithRetry = async () => {
    if (auth.state.creds.registered || !pairingNumber || pairingRequested) return;
    pairingRequested = true;
    pairingAttempts += 1;
    try {
      await new Promise(resolve => setTimeout(resolve, 2500));
      if (auth.state.creds.registered) {
        pairingRequested = false;
        return;
      }
      const code = await sock.requestPairingCode(pairingNumber);
      const formatted = String(code).match(/.{1,4}/g)?.join("-") || code;
      logger.info({ pairing_code: formatted, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4) }, "WHATSAPP PAIRING CODE READY — enter this code in WhatsApp > Linked Devices > Link with phone number");
    } catch (error) {
      pairingRequested = false;
      logger.error({ error, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4) }, "WhatsApp pairing code request failed; retrying while the account is not registered");
      setTimeout(requestPairingCodeWithRetry, 5000);
    }
  };
  if (!auth.state.creds.registered && pairingNumber) setTimeout(requestPairingCodeWithRetry, 1000);

`;
  source = source.replace(trigger, block + trigger);
}

// Ensure the phone pairing helper is started independently of QR events.
if (source.includes("requestPairingCodeWithRetry") && !source.includes("if (!auth.state.creds.registered && pairingNumber) {\n    setTimeout(requestPairingCodeWithRetry, 1000);")) {
  const startTrigger = '  // Do not wait for a QR event. Phone-number pairing is its own flow.';
  if (source.includes(startTrigger) && !source.includes('setTimeout(requestPairingCodeWithRetry, 1000);')) {
    source = source.replace(startTrigger, `${startTrigger}\n  if (!auth.state.creds.registered && pairingNumber) {\n    setTimeout(requestPairingCodeWithRetry, 1000);\n  }`);
  }
}

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

console.log("WhatsApp pairing-code-only patch V11 applied: phone pairing lifecycle fixed; QR disabled; no business/button changes.");
