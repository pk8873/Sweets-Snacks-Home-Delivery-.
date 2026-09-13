#!/usr/bin/env bash
set -u

log() {
  echo "[render-start] $*"
}

log "Starting Django initialization..."
python manage.py collectstatic --no-input
python manage.py migrate
python manage.py check
python create_admin.py

# Webhook setup is useful but must not hold the Render startup forever if
# Telegram is temporarily unreachable. The webhook can be configured again
# on the next restart/deploy.
log "Configuring Telegram webhook (30 second timeout)..."
if timeout 30s python set_telegram_webhook.py; then
  log "Telegram webhook configured."
else
  status=$?
  log "WARNING: Telegram webhook setup did not complete (exit=$status). Continuing startup."
fi

# These scripts only patch the checked-out WhatsApp source and perform a
# JavaScript syntax check. A syntax failure should stop startup rather than
# leaving Render with a half-running WhatsApp process.
log "Preparing WhatsApp source..."
node whatsapp_bot/prepare_pairing.js
node whatsapp_bot/prepare_buttons.js
node --check whatsapp_bot/index.js

log "Starting Django web server..."
gunicorn config.asgi:application -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:${PORT} &
WEB_PID=$!

cleanup() {
  kill "$WEB_PID" 2>/dev/null || true
  if [[ -n "${NODE_PID:-}" ]]; then
    kill "$NODE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Give gunicorn a moment to bind before starting the WhatsApp worker.
sleep 3

# Keep the WhatsApp worker alive. If Baileys exits unexpectedly, restart it
# without taking down the Django web service. The syntax check above prevents
# a broken source file from entering this loop.
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

# Render monitors the HTTP process; keep this process attached to gunicorn.
wait "$WEB_PID"
