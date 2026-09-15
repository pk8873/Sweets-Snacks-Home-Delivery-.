import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V63";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V63 already applied; syntax check passed.");
  process.exit(0);
}

// V63 fixes only the session-reset preparation layer. The previous version
// depended on an exact indentation-sensitive multi-line trigger, while V61/V62
// generate the same auth setup with different indentation. Match the auth call
// itself so V63 remains compatible with the actual V61/V62 source.
const authPattern = /^(\s*)const auth = await usePostgresAuthState\(pool, ["']sweet-snacks-whatsapp["']\);\s*$/m;
const authMatch = source.match(authPattern);
if (!authMatch) {
  throw new Error("V63 could not locate the PostgreSQL WhatsApp auth initialization.");
}

const indent = authMatch[1];
const replacement = `${indent}let auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");

${indent}// V63: allow an explicit, operator-controlled fresh pairing when the
${indent}// persisted PostgreSQL session is already registered. This is OFF by
${indent}// default, so normal Render restarts never disconnect a working account.
${indent}const resetForPairing = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_RESET_SESSION || "").trim());
${indent}if (resetForPairing) {
${indent}  logger.warn("WHATSAPP_RESET_SESSION is enabled: clearing the persisted WhatsApp session so a fresh pairing code can be generated.");
${indent}  await auth.deleteSession();
${indent}  auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
${indent}  logger.warn("Fresh WhatsApp pairing mode is active. After pairing succeeds, remove WHATSAPP_RESET_SESSION from Render and redeploy.");
${indent}} else if (auth.state.creds.registered) {
${indent}  logger.info({ registered: true, linked_jid: auth.state.creds.me?.id || null }, "WhatsApp session is already registered; no pairing code is generated for an existing session");
${indent}}`;

source = source.replace(authPattern, replacement);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const required of [
  "WHATSAPP_RUNTIME_FIX_V63",
  "WHATSAPP_RESET_SESSION",
  "Fresh WhatsApp pairing mode is active",
  "no pairing code is generated for an existing session",
]) {
  if (!finalSource.includes(required)) throw new Error(`V63 validation failed: missing ${required}`);
}

console.log("WhatsApp runtime V63 applied; robust PostgreSQL auth detection + controlled fresh-pairing reset + existing-session diagnostics + syntax validation passed.");
