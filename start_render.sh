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
# V61 is the single consolidated WhatsApp runtime patch. The old V22-V60
# runtime mutators are intentionally no longer executed; keeping dozens of
# sequential source rewrites was the main reason Render builds became fragile.
node whatsapp_bot/prepare_whatsapp_runtime_v61.js || { log "ERROR: WhatsApp runtime V61 preparation failed."; exit 1; }
# V62 keeps the PostgreSQL-persisted WhatsApp session across Render restarts
# and requests a pairing code only when the account is genuinely unregistered.
node whatsapp_bot/prepare_whatsapp_runtime_v62.js || { log "ERROR: WhatsApp runtime V62 preparation failed."; exit 1; }
# V63 adds an explicit operator-controlled reset mode for the case where the
# persisted session is already registered and a fresh pairing code is needed.
# It is OFF by default and never disconnects a working session automatically.
node whatsapp_bot/prepare_whatsapp_runtime_v63.js || { log "ERROR: WhatsApp runtime V63 preparation failed."; exit 1; }
# V64 fixes the remaining interactive-message transport bug. The normal
# WhiskeySockets content path rejects interactiveMessage as media; the helper
# uses the low-level native-flow relay and required WhatsApp biz nodes.
node whatsapp_bot/prepare_whatsapp_runtime_v64.js || { log "ERROR: WhatsApp runtime V64 preparation failed."; exit 1; }
node --check whatsapp_bot/index.js || { log "ERROR: WhatsApp source syntax check failed."; exit 1; }
log "WhatsApp runtime V61 + V62 + V63 + V64 are enabled; legacy runtime patch chain is disabled."

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
