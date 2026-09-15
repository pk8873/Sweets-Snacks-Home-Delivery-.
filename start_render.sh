#!/usr/bin/env bash
set -u

log() { echo "[render-start] $*"; }

log "Starting Django initialization..."
python manage.py collectstatic --no-input
python manage.py migrate
python manage.py check
python create_admin.py

log "Configuring Telegram webhook (30 second timeout)..."
if timeout 30s python set_telegram_webhook.py; then
  log "Telegram webhook configured."
else
  status=$?
  log "WARNING: Telegram webhook setup did not complete (exit=$status). Continuing startup."
fi

log "Preparing WhatsApp source..."
log "Render Git commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
# DEPLOY_MARKER_2026_09_15: always deploy the current main branch so V67/V68/V69/V70/V71/V72/V73/V74
# interactive transport + session lifecycle fixes are not hidden behind an old Render commit.
node whatsapp_bot/prepare_pairing.js || { log "ERROR: WhatsApp pairing preparation failed."; exit 1; }
node whatsapp_bot/prepare_pairing_v7.js || { log "ERROR: WhatsApp pairing V7 preparation failed."; exit 1; }

# V61 is the consolidated WhatsApp lifecycle/transport base.
# V62/V63 only handle session persistence/reset and do not change buttons,
# handlers, cart, orders, payments, delivery, or Django APIs.
# V64/V67 are the interactive transport layer. V67 uses the final active
# low-level helper relay so WhiskeySockets' unsupported-media path is bypassed
# while preserving every existing action ID and business handler.
# V68 fixes only the 401/logout session lifecycle and restores the initial
# LID/history synchronization path.
# V69 fixes only ESM/CJS compatibility for the interactive helper import and
# re-applies the same low-level native-flow transport. No business logic changes.
# V70 is a fail-fast verification layer so an old/high-level button sender
# cannot silently reach production after a stale Render deployment.
# V71 is a final transport-only verification layer; it does not change any
# product, cart, order, payment, delivery, customer, Telegram, Django, or DB logic.
# V72 is a final deploy-marker + helper verification layer so Render cannot
# silently start an older transport revision after this fix is pushed.
# V73 is the previous helper-based interactive transport layer.
# V74 is the final targeted transport fix: direct protobuf construction,
# messageVersion=1, required relay nodes, and quick_reply-only menus so the
# same clickable actions render in WhatsApp Web and mobile clients.
node whatsapp_bot/prepare_whatsapp_runtime_v61.js || { log "ERROR: WhatsApp runtime V61 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v62.js || { log "ERROR: WhatsApp runtime V62 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v63.js || { log "ERROR: WhatsApp runtime V63 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v64.js || { log "ERROR: WhatsApp runtime V64 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v67.js || { log "ERROR: WhatsApp runtime V67 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v68.js || { log "ERROR: WhatsApp runtime V68 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v69.js || { log "ERROR: WhatsApp runtime V69 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v70.js || { log "ERROR: WhatsApp runtime V70 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v71.js || { log "ERROR: WhatsApp runtime V71 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v72.js || { log "ERROR: WhatsApp runtime V72 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v73.js || { log "ERROR: WhatsApp runtime V73 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v74.js || { log "ERROR: WhatsApp runtime V74 preparation failed."; exit 1; }

node --check whatsapp_bot/index.js || { log "ERROR: WhatsApp source syntax check failed."; exit 1; }

node --input-type=module -e 'import fs from "node:fs"; const s=fs.readFileSync("whatsapp_bot/index.js","utf8"); const required=["WHATSAPP_RUNTIME_FIX_V67","WHATSAPP_RUNTIME_FIX_V68","WHATSAPP_RUNTIME_FIX_V69","WHATSAPP_RUNTIME_FIX_V70","WHATSAPP_RUNTIME_FIX_V71","WHATSAPP_RUNTIME_FIX_V72","WHATSAPP_RUNTIME_FIX_V73","WHATSAPP_RUNTIME_FIX_V74","sendNativeFlow(sock, jid","generateWAMessageFromContent","messageVersion: 1","name: \"quick_reply\"","tag: \"biz\"","biz_bot: \"1\"","zqbaileys_helper"]; for (const x of required) { if (!s.includes(x)) throw new Error(`WhatsApp runtime verification failed: ${x}`); } if (s.includes("sendButtons(sock, jid") || s.includes("sendListMessage(sock, jid")) throw new Error("WhatsApp runtime verification failed: convenience interactive transport is still active"); if (s.includes("shouldSyncHistoryMessage: () => false")) throw new Error("WhatsApp runtime verification failed: history-sync suppression is still active"); if (s.includes("buttons: clean.map(x => ({ buttonId:")) throw new Error("WhatsApp runtime verification failed: legacy button payload is still active"); if (s.includes("interactiveMessage: {")) throw new Error("WhatsApp runtime verification failed: high-level interactiveMessage path is still active"); console.log("WhatsApp V74 direct interactive transport verification passed");' || { log "ERROR: WhatsApp runtime verification failed."; exit 1; }

log "WhatsApp runtime V61 + V62 + V63 + V64 + V67 + V68 + V69 + V70 + V71 + V72 + V73 + V74 enabled; V74 is the final active interactive transport enforcement layer."

log "Starting Django web server..."
gunicorn config.asgi:application -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:${PORT} &
WEB_PID=$!

cleanup() {
  kill "$WEB_PID" 2>/dev/null || true
  if [[ -n "${NODE_PID:-}" ]]; then kill "$NODE_PID" 2>/dev/null || true; fi
  if [[ -n "${WHATSAPP_SUPERVISOR_PID:-}" ]]; then kill "$WHATSAPP_SUPERVISOR_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

sleep 3

while true; do
  log "Starting WhatsApp bot..."
  node whatsapp_bot/index.js &
  NODE_PID=$!
  wait "$NODE_PID"
  status=$?
  log "WhatsApp bot exited with status $status; restarting in 5 seconds..."
  sleep 5
done &
WHATSAPP_SUPERVISOR_PID=$!

wait "$WEB_PID"
