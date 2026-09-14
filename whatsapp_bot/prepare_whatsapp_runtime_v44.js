import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V44";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V44 already applied; nothing to do.");
  process.exit(0);
}

if (!source.includes("WHATSAPP_RUNTIME_FIX_V43")) {
  throw new Error("V44 requires the V43 WhatsApp runtime baseline.");
}

// WhatsApp currently validates the companion_platform_display used by the
// phone-number pairing flow more strictly than the normal QR flow. Production
// testing documented by Baileys shows Chrome (Windows) is accepted, while
// values such as Chrome (Acme) are rejected with a silent 400/dead pairing code.
// The V43 socket used Mac OS for the pairing flow; V44 uses the canonical
// Windows/Chrome identity and explicitly supplies the accepted display value.
const browserLine = '    browser: Browsers.macOS("Chrome"),';
const replacement = '    browser: Browsers.windows("Chrome"),\n    companionPlatformDisplay: "Chrome (Windows)",';

if (!source.includes(browserLine)) {
  throw new Error("V44 could not locate the V43 browser configuration.");
}

source = source.replace(browserLine, replacement);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V44 applied; canonical Windows/Chrome pairing identity + companion platform display + syntax check passed.");
