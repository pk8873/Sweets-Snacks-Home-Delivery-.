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

const trigger = '  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");\n  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");';
if (!source.includes(trigger)) {
  throw new Error("V63 could not locate the V61/V62 PostgreSQL WhatsApp auth setup.");
}

const replacement = `  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");
  let auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");

  // V63: allow an explicit, operator-controlled fresh pairing when the
  // persisted PostgreSQL session is already registered. This is OFF by
  // default, so normal Render restarts never disconnect a working account.
  const resetForPairing = /^(1|true|yes)$/i.test(String(process.env.WHATSAPP_RESET_SESSION || "").trim());
  if (resetForPairing) {
    logger.warn("WHATSAPP_RESET_SESSION is enabled: clearing the persisted WhatsApp session so a fresh pairing code can be generated.");
    await auth.deleteSession();
    auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
    logger.warn("Fresh WhatsApp pairing mode is active. After pairing succeeds, remove WHATSAPP_RESET_SESSION from Render and redeploy.");
  } else if (auth.state.creds.registered) {
    logger.info({ registered: true, linked_jid: auth.state.creds.me?.id || null }, "WhatsApp session is already registered; no pairing code is generated for an existing session");
  }`;

source = source.replace(trigger, replacement);
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

console.log("WhatsApp runtime V63 applied; controlled fresh-pairing reset + existing-session diagnostics + syntax validation passed.");
