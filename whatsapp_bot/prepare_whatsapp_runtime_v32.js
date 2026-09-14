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

// V28 inserts its handler branch near the parsed-message log. V32 must ensure
// that branch never references the handler session object before it is created.
// Earlier V32 used one exact declaration string; V31/V28 can legally format
// that declaration differently, so use a structural check instead.
const branchStartToken = "  // V28: state is already declared by the main message handler before this branch.";
const branchStart = source.indexOf(branchStartToken);
if (branchStart < 0) {
  throw new Error("V32 could not locate the V28 handler branch.");
}

const branchEnd = source.indexOf("\n  try {", branchStart);
if (branchEnd < 0) {
  throw new Error("V32 could not locate the end of the V28 handler branch.");
}

const handleStart = source.lastIndexOf("async function handle(sock, m)", branchStart);
if (handleStart < 0) {
  throw new Error("V32 could not locate the WhatsApp message handler.");
}

// Restrict the search to this handler and locate a declaration that contains
// the session variable `s` initialized from state(jid,...). This supports both
// combined declarations and separate const statements.
const handlerPrefix = source.slice(handleStart, branchStart);
const stateRegex = /const\s+[^;{}]*\bs\s*=\s*state\(\s*jid\b[^;{}]*\)\s*[^;{}]*;/m;
const beforeMatch = handlerPrefix.match(stateRegex);

if (beforeMatch) {
  // The state declaration is already before the V28 branch, so no relocation
  // is required. This is the normal case after the V28/V31 patch chain.
  source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
  fs.writeFileSync(file, source, "utf8");
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime fix V32 applied; handler state declaration validated before V28 branch + syntax check passed.");
  process.exit(0);
}

// If the state declaration is after the V28 branch, find it before the outer
// handler try-block and move the complete V28 branch immediately after it.
const outerTryIndex = source.indexOf("\n  try {", branchEnd);
if (outerTryIndex < 0) {
  throw new Error("V32 could not locate the handler try block.");
}

const handlerWindow = source.slice(branchStart, outerTryIndex);
const afterMatch = handlerWindow.match(stateRegex);
if (!afterMatch) {
  throw new Error("V32 could not locate the handler state declaration structurally.");
}

const stateStart = branchStart + afterMatch.index;
const stateEnd = stateStart + afterMatch[0].length;
const branch = source.slice(branchStart, branchEnd);

// Remove the unsafe branch and place it directly after the state declaration.
source = source.slice(0, branchStart) + source.slice(branchEnd);
const newStateEnd = stateEnd - (branchEnd - branchStart);
source = source.slice(0, newStateEnd) + "\n" + branch + source.slice(newStateEnd);

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V32 applied; structurally relocated V28 branch after state initialization + syntax check passed.");
