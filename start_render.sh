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

# One consolidated, idempotent WhatsApp preparation step.
# The prerequisite adds imports needed by the consolidated runtime patch.
node whatsapp_bot/prepare_whatsapp_runtime_prereq.js || {
  log "ERROR: WhatsApp runtime prerequisite preparation failed."
  exit 1
}

node whatsapp_bot/prepare_whatsapp_runtime_v84.js || {
  log "ERROR: WhatsApp runtime V84 preparation failed."
  exit 1
}

node --check whatsapp_bot/index.js || {
  log "ERROR: WhatsApp source syntax check failed."
  exit 1
}

node --input-type=module -e 'import fs from "node:fs"; const s=fs.readFileSync("whatsapp_bot/index.js","utf8"); const required=["WHATSAPP_RUNTIME_FIX_V84","zqbaileys_helper","sendInteractiveMessage(sock, jid","WHATSAPP PAIRING CODE READY","whatsapp.messages.upsert","saveAddress","address_input"]; for (const x of required) { if (!s.includes(x)) throw new Error(`WhatsApp V84 verification failed: ${x}`); } console.log("WhatsApp V84 runtime verification passed");' || {
  log "ERROR: WhatsApp runtime verification failed."
  exit 1
}

log "WhatsApp runtime V84 enabled: helper Native Flow + phone pairing + reconnect + response diagnostics + address/weight flow fixes."

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
