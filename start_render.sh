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
node whatsapp_bot/prepare_pairing.js || {
  log "ERROR: WhatsApp pairing preparation failed."
  exit 1
}
node whatsapp_bot/prepare_pairing_v7.js || {
  log "ERROR: WhatsApp pairing V7 preparation failed."
  exit 1
}
node whatsapp_bot/prepare_whatsapp_runtime.js || {
  log "ERROR: WhatsApp runtime preparation failed."
  exit 1
}
node whatsapp_bot/prepare_whatsapp_runtime_v23.js || {
  log "ERROR: WhatsApp runtime V23 preparation failed."
  exit 1
}
node whatsapp_bot/prepare_whatsapp_runtime_v27.js || {
  log "ERROR: WhatsApp runtime V27 preparation failed."
  exit 1
}
node whatsapp_bot/prepare_whatsapp_runtime_v28.js || {
  log "ERROR: WhatsApp runtime V28 preparation failed."
  exit 1
}
# V29/V30 are intentionally not run. Both depended on brittle assumptions about
# the exact one-line state declaration in index.js. V31 validates the handler
# structurally and patches only stable action/event boundaries.
node whatsapp_bot/prepare_whatsapp_runtime_v31.js || {
  log "ERROR: WhatsApp runtime V31 preparation failed."
  exit 1
}
node --check whatsapp_bot/index.js || {
  log "ERROR: WhatsApp source syntax check failed."
  exit 1
}

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
