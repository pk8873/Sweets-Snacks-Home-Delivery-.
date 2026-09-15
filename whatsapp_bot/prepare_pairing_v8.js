import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_PAIRING_ONLY_V8";
if (source.includes(marker)) {
  console.log("WhatsApp pairing-only patch V8 already applied.");
  process.exit(0);
}

// This patch makes phone-number pairing the only connection UI.
// QR generation/display is disabled; the existing V7 retry helper remains
// responsible for requesting and logging the pairing code.
source = source.replace(/import qrcode from \"qrcode-terminal\";\n?/g, "");

// Remove any QR-terminal fallback left by older pairing patches.
source = source.replace(/\s*else if \(qr && !pairingNumber\) \{\s*qrcode\.generate\(qr, \{ small: true \}\);\s*\}/g, "");
source = source.replace(/\s*if \(qr && !auth\.state\.creds\.registered && pairingNumber && !pairingRequested\) \{/g, "\n    if ((connection === \"connecting\" || qr) && !auth.state.creds.registered && pairingNumber && !pairingRequested) {");

// Guard against any QR-terminal call surviving due to a source-shape change.
source = source.replace(/qrcode\.generate\([^;]+;?/g, "");

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source);

console.log("WhatsApp pairing-only patch V8 applied: QR display disabled; pairing code only.");
