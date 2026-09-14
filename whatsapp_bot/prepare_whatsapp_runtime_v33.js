import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V33";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V33 already applied; nothing to do.");
  process.exit(0);
}

// Do not depend on an exact `}\n\nasync function connect()` boundary.
// Previous V33 failed on Render because earlier runtime patches can change
// whitespace/placement around the handler. Instead, isolate the handler using
// stable function names and then move/validate the session declaration.
const handleStart = source.indexOf("async function handle(sock, m)");
if (handleStart < 0) throw new Error("V33 could not locate WhatsApp message handler.");

const connectStart = source.indexOf("async function connect()", handleStart);
if (connectStart < 0) throw new Error("V33 could not locate WhatsApp connect function.");

let handler = source.slice(handleStart, connectStart);

const declarationPattern = /\n\s*const name = m\.pushName \|\| [\"']Customer[\"'],\s*s = state\(jid, name\),\s*lower = text\.toLowerCase\(\)\.trim\(\);/;
const declarationMatch = handler.match(declarationPattern);

const normalizedDeclaration = "\n  const name = m.pushName || \"Customer\";\n  const s = state(jid, name);\n  const lower = text.toLowerCase().trim();";

if (!declarationMatch) {
  throw new Error("V33 could not locate handler state declaration.");
}

// Find the JID guard by locating the first return in the guard line.
const jidLineStart = handler.indexOf("const jid = m?.key?.remoteJid;");
if (jidLineStart < 0) throw new Error("V33 could not locate handler JID declaration.");
const guardReturn = handler.indexOf("return;", jidLineStart);
if (guardReturn < 0) throw new Error("V33 could not locate handler JID guard return.");
const guardEnd = guardReturn + "return;".length;

// Remove the existing declaration, then insert it immediately after the guard.
const declarationStart = declarationMatch.index;
const declarationEnd = declarationStart + declarationMatch[0].length;
handler = handler.slice(0, declarationStart) + handler.slice(declarationEnd);

const adjustedGuardEnd = guardEnd - (declarationStart < guardEnd ? declarationMatch[0].length : 0);
handler = handler.slice(0, adjustedGuardEnd) + normalizedDeclaration + handler.slice(adjustedGuardEnd);

source = source.slice(0, handleStart) + handler + source.slice(connectStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;

fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V33 applied; robust handler detection + session initialization after JID guard + syntax check passed.");
