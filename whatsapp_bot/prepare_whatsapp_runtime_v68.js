import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V68";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V68 already applied; syntax check passed.");
  process.exit(0);
}

// V68 fixes only the WhatsApp session lifecycle. It deliberately leaves
// product, cart, order, payment, delivery, Django APIs and V67 interactive
// transport unchanged.
const historyTrigger = "syncFullHistory: false, shouldSyncHistoryMessage: () => false";
if (!source.includes(historyTrigger)) {
  throw new Error("V68 could not locate the history-sync suppression in the V61 socket options.");
}
source = source.replace(historyTrigger, "syncFullHistory: false");

const logoutTrigger = 'if (code === 401 || code === DisconnectReason.loggedOut) { logger.error({ status_code: code }, "WhatsApp session invalid/logout; credentials were NOT deleted automatically"); return; }';
if (!source.includes(logoutTrigger)) {
  throw new Error("V68 could not locate the 401/logout lifecycle handler.");
}

const logoutReplacement = `if (code === 401 || code === DisconnectReason.loggedOut) {
        logger.error({ status_code: code }, "WhatsApp session invalid/logout; clearing persisted credentials and preparing fresh pairing");
        try {
          await auth.deleteSession();
          logger.warn("Persisted WhatsApp PostgreSQL session cleared after 401/logout; next connection will request a fresh pairing code");
        } catch (error) {
          logger.error({ error: error?.message || error, stack: error?.stack }, "Failed to clear persisted WhatsApp session after 401/logout");
        }
        reconnectDelayMs = 3000;
        return scheduleReconnect("logged_out_session_reset", 1500);
      }`;

source = source.replace(logoutTrigger, logoutReplacement);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const required of [
  marker,
  "syncFullHistory: false",
  "clearing persisted credentials and preparing fresh pairing",
  "Persisted WhatsApp PostgreSQL session cleared after 401/logout; next connection will request a fresh pairing code",
  'scheduleReconnect("logged_out_session_reset", 1500)',
]) {
  if (!finalSource.includes(required)) throw new Error(`V68 validation failed: missing ${required}`);
}
if (finalSource.includes("shouldSyncHistoryMessage: () => false")) {
  throw new Error("V68 validation failed: history-sync suppression is still active.");
}

console.log("WhatsApp runtime V68 applied; session 401 reset + initial LID/history sync restoration + syntax validation passed.");
