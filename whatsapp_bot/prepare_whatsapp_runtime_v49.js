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
const poolAnchor = 'const pool = WHATSAPP_DATABASE_URL ? new Pool({ connectionString: WHATSAPP_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;';
if (!source.includes(poolAnchor)) {
  throw new Error("V49 could not locate the WhatsApp PostgreSQL pool declaration.");
}

const stateHelper = `\nconst WHATSAPP_PAIRING_STATE_KEY = "pairing_rate_limit";\nconst ensurePairingStateTable = async () => {\n  if (!pool) return;\n  await pool.query(\n    "CREATE TABLE IF NOT EXISTS whatsapp_runtime_state (state_key TEXT PRIMARY KEY, value_text TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"\n  );\n};\nconst loadPairingCooldown = async () => {\n  if (!pool) return 0;\n  try {\n    await ensurePairingStateTable();\n    const result = await pool.query(\n      "SELECT value_text FROM whatsapp_runtime_state WHERE state_key = $1 LIMIT 1",\n      [WHATSAPP_PAIRING_STATE_KEY]\n    );\n    const until = Number(result.rows[0]?.value_text || 0);\n    return Number.isFinite(until) ? until : 0;\n  } catch (error) {\n    logger.warn({ error: error?.message || error }, "Unable to load persisted WhatsApp pairing cooldown; continuing with process-local cooldown");\n    return 0;\n  }\n};\nconst savePairingCooldown = async (until) => {\n  if (!pool) return;\n  try {\n    await ensurePairingStateTable();\n    await pool.query(\n      "INSERT INTO whatsapp_runtime_state (state_key, value_text, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (state_key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = NOW()",\n      [WHATSAPP_PAIRING_STATE_KEY, String(Math.trunc(until))]\n    );\n  } catch (error) {\n    logger.warn({ error: error?.message || error }, "Unable to persist WhatsApp pairing cooldown");\n  }\n};\nconst clearPairingCooldown = async () => savePairingCooldown(0);\n`;

if (!source.includes("WHATSAPP_PAIRING_STATE_KEY")) {
  source = source.replace(poolAnchor, poolAnchor + stateHelper);
}

const connectAnchor = '  const pairingNumber = String(process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\\D/g, "");';
if (!source.includes(connectAnchor)) {
  throw new Error("V49 could not locate pairing-number initialization.");
}

const loadBlock = `  const persistedPairingCooldown = await loadPairingCooldown();\n  if (persistedPairingCooldown > whatsappPairingRateLimitedUntil) {\n    whatsappPairingRateLimitedUntil = persistedPairingCooldown;\n  }\n  if (whatsappPairingRateLimitedUntil > Date.now()) {\n    logger.warn({\n      retry_after: new Date(whatsappPairingRateLimitedUntil).toISOString(),\n      wait_minutes: Math.ceil((whatsappPairingRateLimitedUntil - Date.now()) / 60_000),\n    }, "WhatsApp pairing cooldown restored from PostgreSQL; no pairing request will be sent until it expires.");\n  }\n`;
if (!source.includes("persistedPairingCooldown")) {
  source = source.replace(connectAnchor, connectAnchor + "\n" + loadBlock);
}

const requestRateLimitAnchor = '        whatsappPairingRateLimitedUntil = Date.now() + WHATSAPP_PAIRING_RATE_LIMIT_COOLDOWN_MS;';
if (!source.includes(requestRateLimitAnchor)) {
  throw new Error("V49 could not locate the pairing request 429 handler.");
}
source = source.replace(
  requestRateLimitAnchor,
  requestRateLimitAnchor + '\n        await savePairingCooldown(whatsappPairingRateLimitedUntil);'
);

const closeRateLimitAnchor = '        whatsappPairingRateLimitedUntil = Math.max(\n          whatsappPairingRateLimitedUntil,\n          Date.now() + WHATSAPP_PAIRING_RATE_LIMIT_COOLDOWN_MS,\n        );';
if (!source.includes(closeRateLimitAnchor)) {
  throw new Error("V49 could not locate the connection-close 429 handler.");
}
source = source.replace(
  closeRateLimitAnchor,
  closeRateLimitAnchor + '\n        await savePairingCooldown(whatsappPairingRateLimitedUntil);'
);

const openAnchor = '      whatsappPairingRateLimitedUntil = 0;';
if (!source.includes(openAnchor)) {
  throw new Error("V49 could not locate the WhatsApp connection-open cooldown reset.");
}
source = source.replace(
  openAnchor,
  openAnchor + '\n      await clearPairingCooldown();'
);

source = source.replace(/\\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V49 applied; pairing 429 cooldown is persisted in PostgreSQL + syntax check passed.");
