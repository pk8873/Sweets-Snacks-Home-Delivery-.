import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V53";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V53 already applied; nothing to do.");
  process.exit(0);
}

// V52 wrote its final marker with escaped newline characters. That made the
// generated index.js invalid JavaScript. Repair only that malformed V52 tail,
// preserve all existing bot logic, then validate the complete source.
const malformed = "\\n\\n// WHATSAPP_RUNTIME_FIX_V52\\n";
const proper = "\n\n// WHATSAPP_RUNTIME_FIX_V52\n";

if (source.endsWith(malformed)) {
  source = source.slice(0, -malformed.length) + proper;
} else if (source.includes(malformed)) {
  source = source.replace(malformed, proper);
} else if (!source.includes("WHATSAPP_RUNTIME_FIX_V52")) {
  throw new Error("V53 expected the V52 marker but it was not found.");
}

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V53 applied; repaired V52 marker/newline corruption + syntax check passed.");
