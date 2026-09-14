import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V38";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V38 already applied; nothing to do.");
  process.exit(0);
}

// V38 fixes the actual pairing failure shown by Render:
// V7's timer requests the pairing code before the socket reaches the QR/auth
// stage. That sets pairingRequested=true, so the V4 QR handler is blocked.
// Baileys pairing is expected to request the code from the QR/ready event.
// Remove only V7's duplicate timer/helper and keep the V4 QR-triggered flow.
const v7PairingBlock = /  \/\/ WHATSAPP_PAIRING_PATCH_V7[\\s\\S]*?\n  sock\.ev\.on\("creds\.update", auth\.saveCreds\);/;
if (v7PairingBlock.test(source)) {
  source = source.replace(v7PairingBlock, '  // WHATSAPP_RUNTIME_FIX_V38_PAIRING_FLOW\n  sock.ev.on("creds.update", auth.saveCreds);');
}

// Request the code only after WhatsApp emits the QR/auth-ready event.
source = source.replace(
  'if ((connection === "connecting" || qr) && !auth.state.creds.registered && pairingNumber && !pairingRequested) {',
  'if (qr && !auth.state.creds.registered && pairingNumber && !pairingRequested) {'
);

// WhatsApp validates the pairing-code browser display more strictly than the
// normal linked-device flow. Use a canonical browser tuple instead of the
// custom "Sweet & Snacks" label. The canonical tuple produces Chrome (Mac OS).
const browserPattern = /browser:\s*Browsers\.(?:ubuntu|windows|macOS)\([^\n]*?\),/;
if (!browserPattern.test(source)) {
  throw new Error("V38 could not locate the WhatsApp browser configuration.");
}
source = source.replace(browserPattern, 'browser: Browsers.macOS("Chrome"),');

// Never override the canonical pairing display with a custom label.
source = source.replace(/\s*companionPlatformDisplay:\s*"[^"]+",\n/g, "\n");

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V38 applied; QR-gated pairing + canonical Chrome browser + syntax check passed.");
