import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V34";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V34 already applied; nothing to do.");
  process.exit(0);
}

// V34 previously used a nested template literal inside String.raw, which made
// the preparation script itself invalid JavaScript on Render. Keep this step
// intentionally safe: V33 already installed the normalized message handler.
// V35 handles the Native Flow transport separately.
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
source = source.replace(/\n+$/, "") + "\n\n// " + marker + "\n";
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V34 compatibility shim applied; V33 handler retained + syntax check passed.");
