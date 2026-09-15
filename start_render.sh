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
node whatsapp_bot/prepare_pairing.js || { log "ERROR: WhatsApp pairing preparation failed."; exit 1; }
node whatsapp_bot/prepare_pairing_v7.js || { log "ERROR: WhatsApp pairing V7 preparation failed."; exit 1; }

# V61 is the consolidated WhatsApp lifecycle/transport base.
# V62/V63 only handle session persistence/reset and do not change buttons,
# handlers, cart, orders, payments, delivery, or Django APIs.
# V64/V67 are the interactive transport layer. V67 is the final active
# transport fix and deliberately uses zqbaileys_helper's low-level
# sendInteractiveMessage relay so WhiskeySockets' unsupported-media path is
# bypassed while preserving every existing action ID and business handler.
node whatsapp_bot/prepare_whatsapp_runtime_v61.js || { log "ERROR: WhatsApp runtime V61 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v62.js || { log "ERROR: WhatsApp runtime V62 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v63.js || { log "ERROR: WhatsApp runtime V63 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v64.js || { log "ERROR: WhatsApp runtime V64 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v67.js || { log "ERROR: WhatsApp runtime V67 preparation failed."; exit 1; }

node --check whatsapp_bot/index.js || { log "ERROR: WhatsApp source syntax check failed."; exit 1; }

node --input-type=module -e 'import fs from "node:fs"; const s=fs.readFileSync("whatsapp_bot/index.js","utf8"); const required=["WHATSAPP_RUNTIME_FIX_V67","zqbaileys_helper","sendInteractiveMessage","name: \"quick_reply\"","name: \"single_select\""]; for (const x of required) { if (!s.includes(x)) throw new Error(`WhatsApp V67 verification failed: ${x}`); } if (s.includes("sendButtons") || s.includes("sendListMessage")) throw new Error("WhatsApp V67 verification failed: convenience interactive transport is still active"); console.log("WhatsApp interactive transport verification passed: V67 low-level helper relay");' || { log "ERROR: WhatsApp interactive transport verification failed."; exit 1; }

log "WhatsApp runtime V61 + V62 + V63 + V64 + V67 enabled; V67 is the final interactive transport layer."

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
