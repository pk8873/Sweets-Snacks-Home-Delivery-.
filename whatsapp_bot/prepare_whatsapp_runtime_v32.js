import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V32";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V32 already applied; nothing to do.");
  process.exit(0);
}

// V28 inserted its handler branch immediately after the parsed-message log.
// V31 kept that placement, which means the branch can reference `s` before
// the handler's `const ... s = state(...)` declaration. That causes the exact
// Render error: Cannot access 's' before initialization.
const branchStartToken = "  // V28: state is already declared by the main message handler before this branch.";
const stateLine = "  const name = m.pushName || \"Customer\", s = state(jid, name), lower = text.toLowerCase().trim();";

const branchStart = source.indexOf(branchStartToken);
if (branchStart < 0) {
  throw new Error("V32 could not locate the V28 handler branch.");
}

const branchEnd = source.indexOf("\n  try {", branchStart);
if (branchEnd < 0) {
  throw new Error("V32 could not locate the end of the V28 handler branch.");
}

const stateIndex = source.indexOf(stateLine);
if (stateIndex < 0 || stateIndex > branchStart) {
  throw new Error("V32 could not locate the handler state declaration.");
}

const stateEnd = stateIndex + stateLine.length;
const branch = source.slice(branchStart, branchEnd);

// Remove the V28 branch from its unsafe location.
source = source.slice(0, branchStart) + source.slice(branchEnd);

// Recalculate the state declaration position after removal and place the branch
// immediately after it, so `s` is initialized before any V28 branch uses it.
const newStateIndex = source.indexOf(stateLine);
if (newStateIndex < 0) {
  throw new Error("V32 lost the handler state declaration while relocating the branch.");
}
const newStateEnd = newStateIndex + stateLine.length;
source = source.slice(0, newStateEnd) + "\n" + branch + source.slice(newStateEnd);

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V32 applied; moved V28 handler branch after state initialization + syntax check passed.");
