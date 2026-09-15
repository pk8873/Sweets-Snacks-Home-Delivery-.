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
node whatsapp_bot/prepare_pairing.js || { log "ERROR: WhatsApp pairing preparation failed."; exit 1; }
node whatsapp_bot/prepare_pairing_v7.js || { log "ERROR: WhatsApp pairing V7 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime.js || { log "ERROR: WhatsApp runtime preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v23.js || { log "ERROR: WhatsApp runtime V23 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v27.js || { log "ERROR: WhatsApp runtime V27 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v28.js || { log "ERROR: WhatsApp runtime V28 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v31.js || { log "ERROR: WhatsApp runtime V31 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v32.js || { log "ERROR: WhatsApp runtime V32 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v33.js || { log "ERROR: WhatsApp runtime V33 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v34.js || { log "ERROR: WhatsApp runtime V34 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v35.js || { log "ERROR: WhatsApp runtime V35 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v36.js || { log "ERROR: WhatsApp runtime V36 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v37.js || { log "ERROR: WhatsApp runtime V37 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v38.js || { log "ERROR: WhatsApp runtime V38 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v39.js || { log "ERROR: WhatsApp runtime V39 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v40.js || { log "ERROR: WhatsApp runtime V40 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v41.js || { log "ERROR: WhatsApp runtime V41 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v43.js || { log "ERROR: WhatsApp runtime V43 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v44.js || { log "ERROR: WhatsApp runtime V44 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v45.js || { log "ERROR: WhatsApp runtime V45 validation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v46.js || { log "ERROR: WhatsApp runtime V46 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v47.js || { log "ERROR: WhatsApp runtime V47 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v48.js || { log "ERROR: WhatsApp runtime V48 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v49.js || { log "ERROR: WhatsApp runtime V49 preparation failed."; exit 1; }
# V50 prevents repeated Render-side WhatsApp disconnect/re-pair loops.
# 515 is handled as a socket restart while preserving PostgreSQL auth state.
# 401/logout no longer deletes the stored session automatically.
node whatsapp_bot/prepare_whatsapp_runtime_v50.js || { log "ERROR: WhatsApp runtime V50 preparation failed."; exit 1; }
# V51 fixes the WhatsApp button rendering layer only. It builds Native Flow
# protobuf messages directly and relays the required bot/biz nodes.
# It does NOT change customer/business handlers.
node whatsapp_bot/prepare_whatsapp_runtime_v51.js || { log "ERROR: WhatsApp runtime V51 preparation failed."; exit 1; }
# V52 hardens the Native Flow relay: retry without optional extra nodes before
# falling back to plain text. No customer/business handlers are changed.
node whatsapp_bot/prepare_whatsapp_runtime_v52.js || { log "ERROR: WhatsApp runtime V52 preparation failed."; exit 1; }
# V53 repairs the V52 marker/newline corruption and validates the final source.
node whatsapp_bot/prepare_whatsapp_runtime_v53.js || { log "ERROR: WhatsApp runtime V53 preparation failed."; exit 1; }
# V54 refreshes the live WhatsApp Web protocol version before every socket.
# This targets the current 403 Connection Failure during the login handshake.
node whatsapp_bot/prepare_whatsapp_runtime_v54.js || { log "ERROR: WhatsApp runtime V54 preparation failed."; exit 1; }
# V55 fixes only the interactive-message transport. It mirrors the proven
# MD-compatible relay structure: documentWithCaptionMessage + biz + bot nodes.
# It does NOT delete or recreate WhatsApp auth/session data.
node whatsapp_bot/prepare_whatsapp_runtime_v55.js || { log "ERROR: WhatsApp runtime V55 preparation failed."; exit 1; }
# V56 is a fail-fast validation that guarantees the V55 low-level Native Flow
# relay is the active sender before the WhatsApp process starts.
node whatsapp_bot/prepare_whatsapp_runtime_v56.js || { log "ERROR: WhatsApp runtime V56 validation failed."; exit 1; }
# V57 fixes the remaining Native Flow relay metadata only. It adds the
# required business/native-flow attributes while preserving all handlers.
node whatsapp_bot/prepare_whatsapp_runtime_v57.js || { log "ERROR: WhatsApp runtime V57 preparation failed."; exit 1; }
node --check whatsapp_bot/index.js || { log "ERROR: WhatsApp source syntax check failed."; exit 1; }

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
