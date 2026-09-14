import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V37";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V37 already applied; nothing to do.");
  process.exit(0);
}

// V37 addresses the current Render disconnect pattern:
// the runtime was advertising a Windows desktop companion even though this
// is a server-side bot. Current WhatsApp/Baileys reports show the WIN32/DARWIN
// desktop sub-platform can be terminated by WhatsApp, while WEB_BROWSER is
// accepted on the same server/account. Return to the WEB_BROWSER-style Ubuntu
// browser tuple used by the original socket and remove the custom companion
// platform display override.
const oldBrowser = 'browser: Browsers.windows("Chrome"),';
const newBrowser = 'browser: Browsers.ubuntu("Sweet & Snacks"),';
if (!source.includes(oldBrowser)) {
  throw new Error("V37 could not locate the Windows Chrome browser configuration.");
}
source = source.replace(oldBrowser, newBrowser);

const companion = '    companionPlatformDisplay: "Chrome (Windows)",\n';
if (!source.includes(companion)) {
  throw new Error("V37 could not locate the Windows companionPlatformDisplay override.");
}
source = source.replace(companion, "");

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V37 applied; WEB_BROWSER-style browser + no custom desktop companion display + syntax check passed.");
