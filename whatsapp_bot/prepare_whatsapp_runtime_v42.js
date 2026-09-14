import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V42";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V42 already applied; nothing to do.");
  process.exit(0);
}

const oldBlock = `  const pairingMode = String(process.env.WHATSAPP_PAIRING_MODE || "qr").trim().toLowerCase();
  const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\\D/g, "");`;

const newBlock = `  const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\\D/g, "");
  const configuredPairingMode = String(process.env.WHATSAPP_PAIRING_MODE || "auto").trim().toLowerCase();
  // auto = pairing code when a phone number is configured, otherwise QR.
  // This removes the common Render mistake where the bot silently stays in QR mode.
  const pairingMode = configuredPairingMode === "auto"
    ? (pairingNumber ? "code" : "qr")
    : configuredPairingMode;`;

if (!source.includes(oldBlock)) {
  throw new Error("V42 could not locate the V41 pairing mode block.");
}
source = source.replace(oldBlock, newBlock);

const oldValidation = `  if (!["qr", "code"].includes(pairingMode)) {
    throw new Error("WHATSAPP_PAIRING_MODE must be either 'qr' or 'code'.");
  }`;
const newValidation = `  if (!["auto", "qr", "code"].includes(configuredPairingMode)) {
    throw new Error("WHATSAPP_PAIRING_MODE must be 'auto', 'qr', or 'code'.");
  }`;
if (!source.includes(oldValidation)) {
  throw new Error("V42 could not locate pairing mode validation.");
}
source = source.replace(oldValidation, newValidation);

const oldDelay = `      await new Promise(resolve => setTimeout(resolve, 12_000));`;
const newDelay = `      // Give the registration socket time to finish its initial handshake.
      // Only one request is made per connection; no 429 retry loop is created.
      await new Promise(resolve => setTimeout(resolve, 20_000));`;
if (!source.includes(oldDelay)) {
  throw new Error("V42 could not locate pairing delay.");
}
source = source.replace(oldDelay, newDelay);

const oldStart = `    logger.info({
      wa_web_version: version,
      is_latest: isLatest,
      pairing_mode: pairingMode,
      registered: Boolean(auth.state.creds.registered),
    }, "Using WhatsApp Web version and pairing mode");`;
const newStart = `    logger.info({
      wa_web_version: version,
      is_latest: isLatest,
      configured_pairing_mode: configuredPairingMode,
      pairing_mode: pairingMode,
      phone_configured: Boolean(pairingNumber),
      registered: Boolean(auth.state.creds.registered),
    }, "Using WhatsApp Web version and pairing mode");

  if (!auth.state.creds.registered && pairingMode === "code") {
    logger.info({
      pairing_number_suffix: pairingNumber.slice(-4),
    }, "PAIRING CODE MODE ENABLED — a fresh code will be requested once after WhatsApp registration handshake");
  }`;
if (!source.includes(oldStart)) {
  throw new Error("V42 could not locate pairing startup log.");
}
source = source.replace(oldStart, newStart);

source = source.replace(/\\n+$/, "") + `\\n\\n// ${marker}\\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V42 applied; auto pairing-code mode + single delayed request + syntax check passed.");
