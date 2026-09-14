import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V39";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V39 already applied; nothing to do.");
  process.exit(0);
}

// V39 addresses the Render logs where the QR/auth event is received but the
// first requestPairingCode() immediately gets WhatsApp error 429. Repeated
// pairing requests can also corrupt pairing state, so V39 serializes requests,
// waits for the socket to settle, and uses a slow backoff instead of hammering
// the pairing endpoint.
const pattern = /if \(qr && !auth\.state\.creds\.registered && pairingNumber && !pairingRequested\) \{[\s\S]*?\n    \} else if \(qr && !pairingNumber\) \{/;

if (!pattern.test(source)) {
  throw new Error("V39 could not locate the QR-gated pairing block.");
}

const replacement = `if (qr && !auth.state.creds.registered && pairingNumber && !pairingRequested) {
      pairingRequested = true;
      pairingAttempts += 1;

      // WhatsApp can emit QR/auth readiness before the companion registration
      // endpoint is ready for a phone-number pairing request. Waiting here
      // avoids the immediate 429 seen on Render.
      await new Promise(resolve => setTimeout(resolve, 8000));

      try {
        if (auth.state.creds.registered) return;

        const code = await sock.requestPairingCode(pairingNumber);
        const formatted = String(code).match(/.{1,4}/g)?.join("-") || code;
        logger.info(
          {
            pairing_code: formatted,
            pairing_attempt: pairingAttempts,
            pairing_number_suffix: pairingNumber.slice(-4),
            pairing_backoff: "8s-initial / 60s-on-error",
          },
          "WHATSAPP PAIRING CODE READY — enter it in WhatsApp > Linked Devices > Link with phone number"
        );
      } catch (error) {
        pairingRequested = false;
        const status = new Boom(error)?.output?.statusCode;
        logger.error(
          {
            error,
            status_code: status,
            pairing_attempt: pairingAttempts,
            pairing_number_suffix: pairingNumber.slice(-4),
          },
          "WhatsApp pairing request failed; backing off for 60 seconds before one controlled retry"
        );
        if (!auth.state.creds.registered && pairingAttempts < 3) {
          setTimeout(() => {
            if (!auth.state.creds.registered && !pairingRequested) {
              pairingRequested = true;
              pairingAttempts += 1;
              sock.requestPairingCode(pairingNumber)
                .then(code => {
                  const formatted = String(code).match(/.{1,4}/g)?.join("-") || code;
                  logger.info(
                    { pairing_code: formatted, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4) },
                    "WHATSAPP PAIRING CODE READY — enter it in WhatsApp > Linked Devices > Link with phone number"
                  );
                })
                .catch(retryError => {
                  pairingRequested = false;
                  logger.error(
                    { error: retryError, pairing_attempt: pairingAttempts, pairing_number_suffix: pairingNumber.slice(-4) },
                    "WhatsApp controlled pairing retry failed; waiting for a fresh deployment or next QR cycle"
                  );
                });
            }
          }, 60_000);
        }
      }
    } else if (qr && !pairingNumber) {`;

source = source.replace(pattern, replacement);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V39 applied; pairing 429 backoff + serialized retry + syntax check passed.");
