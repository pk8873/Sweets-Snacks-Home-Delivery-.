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

const handleStart = source.indexOf("async function handle(sock, m)");
if (handleStart < 0) throw new Error("V33 could not locate WhatsApp message handler.");

const handleEnd = source.indexOf("\n}\n\nasync function connect()", handleStart);
if (handleEnd < 0) throw new Error("V33 could not locate WhatsApp message handler end.");

let handler = source.slice(handleStart, handleEnd + 2);

// V28/V32 can leave action branches before the handler's session declaration.
// Initialize the session immediately after the JID guard, before ANY action branch.
const stateDecl = handler.match(/\n\s*const name = m\.pushName \|\| "Customer", s = state\(jid, name\), lower = text\.toLowerCase\(\)\.trim\(\);/);
if (!stateDecl) {
  throw new Error("V33 could not locate the handler state declaration.");
}

handler = handler.replace(stateDecl[0], "\n  const name = m.pushName || \"Customer\";\n  const s = state(jid, name);\n  const lower = text.toLowerCase().trim();");

const jidGuard = /const jid = m\?\.key\?\.remoteJid;[\s\S]*?return;/m.exec(handler);
if (!jidGuard) throw new Error("V33 could not locate the handler JID guard.");

const declaration = "\n  const name = m.pushName || \"Customer\";\n  const s = state(jid, name);\n  const lower = text.toLowerCase().trim();";
const declIndex = handler.indexOf(declaration);
if (declIndex < 0) throw new Error("V33 could not locate normalized state declaration.");

// Remove the declaration from its old location, then place it directly after
// the complete JID guard. This removes the TDZ path regardless of V28/V32 order.
handler = handler.slice(0, declIndex) + handler.slice(declIndex + declaration.length);
const guardEnd = jidGuard.index + jidGuard[0].length;
const newDeclaration = declaration + "\n";
handler = handler.slice(0, guardEnd) + newDeclaration + handler.slice(guardEnd);

source = source.slice(0, handleStart) + handler + source.slice(handleEnd + 2);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;

fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V33 applied; handler session initialized before all action branches + syntax check passed.");
