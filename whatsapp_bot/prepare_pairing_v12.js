import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_PAIRING_FRESH_CODE_V12";
if (source.includes(marker)) {
  console.log("WhatsApp pairing V12 already applied.");
  process.exit(0);
}

// Pairing-only fix. This file intentionally does not modify buttons, lists,
// products, cart, orders, payments, Django API calls, or message handling.
//
// V10/V9 use fs inside the generated index.js pairing lifecycle. The original
// index.js did not import node:fs, so the fresh-pairing switch could fail before
// it could clear the stored session and request a new pairing code.
if (!source.includes('import fs from "node:fs";')) {
  source = `import fs from "node:fs";\n${source}`;
}

// Accept both names so an existing Render variable cannot silently disable
// phone-number pairing. The primary project variable remains WHATSAPP_PHONE_NUMBER.
const oldPairingNumber = 'const pairingNumber = (process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\\\\D/g, "");';
const newPairingNumber = 'const pairingNumber = (process.env.WHATSAPP_PHONE_NUMBER || process.env.WHATSAPP_PAIRING_NUMBER || "").replace(/\\\\D/g, "");';
if (source.includes(oldPairingNumber)) {
  source = source.replace(oldPairingNumber, newPairingNumber);
}

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

console.log("WhatsApp pairing V12 applied: fresh phone pairing code lifecycle fixed; no business/button changes.");
