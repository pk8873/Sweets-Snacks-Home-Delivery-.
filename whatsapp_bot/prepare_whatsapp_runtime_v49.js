import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V49";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V49 already applied; nothing to do.");
  process.exit(0);
}

if (!source.includes("WHATSAPP_RUNTIME_FIX_V48")) {
  throw new Error("V49 requires the V48 WhatsApp runtime baseline.");
}

// Persist the WhatsApp pairing 429 cooldown in PostgreSQL. Render can restart
// the Node process during the WhatsApp cooldown; without persistence a restart
// would immediately call requestPairingCode() again and receive another 429.
//
// Do not depend on one exact formatting of the Pool declaration. Earlier
// runtime patches can change whitespace or pool options, which made the old
// exact-string check fail on a fresh Render build even though the pool existed.
const poolPattern = /const\s+pool\s*=\s*WHATSAPP_DATABASE_URL\s*\?\s*new\s+Pool\(\{[\s\S]*?\}\)\s*:\s*null;/;
const poolMatch = source.match(poolPattern);
if (!poolMatch) {
  throw new Error("V49 could not locate the WhatsApp PostgreSQL pool declaration.");
}
const poolAnchor = poolMatch[0];

const stateHelper = `
const WHATSAPP_PAIRING_STATE_KEY = "pairing_rate_limit";
const ensurePairingStateTable = async () => {
  if (!pool) return;
  await pool.query(
    "CREATE TABLE IF NOT EXISTS whatsapp_runtime_state (state_key TEXT PRIMARY KEY, value_text TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
  );
};
const loadPairingCooldown = async () => {
  if (!pool) return 0;
  try {
    await ensurePairingStateTable();
    const result = await pool.query(
      "SELECT value_text FROM whatsapp_runtime_state WHERE state_key = $1 LIMIT 1",
      [WHATSAPP_PAIRING_STATE_KEY]
    );
    const until = Number(result.rows[0]?.value_text || 0);
    return Number.isFinite(until) ? until : 0;
  } catch (error) {
    logger.warn({ error: error?.message || error }, "Unable to load persisted WhatsApp pairing cooldown; continuing with process-local cooldown");
    return 0;
  }
};
const savePairingCooldown = async (until) => {
  if (!pool) return;
  try {
    await ensurePairingStateTable();
    await pool.query(
      "INSERT INTO whatsapp_runtime_state (state_key, value_text, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (state_key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = NOW()",
      [WHATSAPP_PAIRING_STATE_KEY, String(Math.trunc(until))]
    );
  } catch (error) {
    logger.warn({ error: error?.message || error }, "Unable to persist WhatsApp pairing cooldown");
  }
};
const clearPairingCooldown = async () => savePairingCooldown(0);
`;

if (!source.includes("WHATSAPP_PAIRING_STATE_KEY")) {
  source = source.replace(poolAnchor, poolAnchor + stateHelper);
}

const pairingNumberPattern = /  const pairingNumber = String\(process\.env\.WHATSAPP_PHONE_NUMBER \|\| ""\)\.replace\(\/\\\\D\/g, ""\);/;
const pairingNumberMatch = source.match(pairingNumberPattern);
if (!pairingNumberMatch) {
  throw new Error("V49 could not locate pairing-number initialization.");
}
const pairingNumberAnchor = pairingNumberMatch[0];

const loadBlock = `  const persistedPairingCooldown = await loadPairingCooldown();
  if (persistedPairingCooldown > whatsappPairingRateLimitedUntil) {
    whatsappPairingRateLimitedUntil = persistedPairingCooldown;
  }
  if (whatsappPairingRateLimitedUntil > Date.now()) {
    logger.warn({
      retry_after: new Date(whatsappPairingRateLimitedUntil).toISOString(),
      wait_minutes: Math.ceil((whatsappPairingRateLimitedUntil - Date.now()) / 60_000),
    }, "WhatsApp pairing cooldown restored from PostgreSQL; no pairing request will be sent until it expires.");
  }
`;
if (!source.includes("persistedPairingCooldown")) {
  source = source.replace(pairingNumberAnchor, pairingNumberAnchor + "\n" + loadBlock);
}

const requestRateLimitPattern = /        whatsappPairingRateLimitedUntil\s*=\s*Date\.now\(\)\s*\+\s*WHATSAPP_PAIRING_RATE_LIMIT_COOLDOWN_MS;/;
const requestRateLimitMatch = source.match(requestRateLimitPattern);
if (!requestRateLimitMatch) {
  throw new Error("V49 could not locate the pairing request 429 handler.");
}
const requestRateLimitAnchor = requestRateLimitMatch[0];
if (!source.includes("await savePairingCooldown(whatsappPairingRateLimitedUntil);")) {
  source = source.replace(
    requestRateLimitAnchor,
    requestRateLimitAnchor + "\n        await savePairingCooldown(whatsappPairingRateLimitedUntil);"
  );
}

const closeRateLimitPattern = /        whatsappPairingRateLimitedUntil\s*=\s*Math\.max\([\s\S]*?\n        \);/;
const closeRateLimitMatch = source.match(closeRateLimitPattern);
if (!closeRateLimitMatch) {
  throw new Error("V49 could not locate the connection-close 429 handler.");
}
const closeRateLimitAnchor = closeRateLimitMatch[0];
if (!source.includes("await savePairingCooldown(whatsappPairingRateLimitedUntil);")) {
  source = source.replace(
    closeRateLimitAnchor,
    closeRateLimitAnchor + "\n        await savePairingCooldown(whatsappPairingRateLimitedUntil);"
  );
}

const openAnchor = "      whatsappPairingRateLimitedUntil = 0;";
if (!source.includes(openAnchor)) {
  throw new Error("V49 could not locate the WhatsApp connection-open cooldown reset.");
}
if (!source.includes("await clearPairingCooldown();")) {
  source = source.replace(
    openAnchor,
    openAnchor + "\n      await clearPairingCooldown();"
  );
}

source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V49 applied; robust PostgreSQL pool detection + pairing cooldown persistence + syntax check passed.");
