import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V36";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V36 already applied; nothing to do.");
  process.exit(0);
}

const handleStart = source.indexOf("async function handle(sock, m)");
if (handleStart < 0) throw new Error("V36 could not locate WhatsApp message handler.");
const connectStart = source.indexOf("async function connect()", handleStart);
if (connectStart < 0) throw new Error("V36 could not locate WhatsApp connect function.");

let handler = source.slice(handleStart, connectStart);

// V33 moved the session declaration before `const text = textOf(m)`. That
// accidentally left `const lower = text.toLowerCase()` in the temporal dead
// zone of the later text declaration, causing every incoming message to fail
// with: Cannot access 'text' before initialization.
const textDeclaration = /\n\s*const text = textOf\(m\),\s*action = actionOf\(m\),\s*location = incomingLocation\(m\),\s*contact = incomingContact\(m\);/;
const match = handler.match(textDeclaration);
if (!match) throw new Error("V36 could not locate the WhatsApp text/action declaration.");

handler = handler.slice(0, match.index) + handler.slice(match.index + match[0].length);

const lowerMarker = "const lower = text.toLowerCase().trim();";
const lowerIndex = handler.indexOf(lowerMarker);
if (lowerIndex < 0) throw new Error("V36 could not locate the lower-case text declaration.");

const declarations = "const text = textOf(m), action = actionOf(m), location = incomingLocation(m), contact = incomingContact(m);\n  ";
handler = handler.slice(0, lowerIndex) + declarations + handler.slice(lowerIndex);

source = source.slice(0, handleStart) + handler + source.slice(connectStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;

fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V36 applied; text initialization order fixed + syntax check passed.");
