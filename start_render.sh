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
# WhatsApp lifecycle/session fixes remain unchanged. V77 is the final
# interactive transport repair and uses the tested zqbaileys_helper relay.
# V78 only verifies the final transport before the bot starts.
# V8 disables QR display and keeps phone-number pairing code as the only
# WhatsApp connection method.
node whatsapp_bot/prepare_pairing.js || { log "ERROR: WhatsApp pairing preparation failed."; exit 1; }
node whatsapp_bot/prepare_pairing_v7.js || { log "ERROR: WhatsApp pairing V7 preparation failed."; exit 1; }
node whatsapp_bot/prepare_pairing_v8.js || { log "ERROR: WhatsApp pairing V8 preparation failed."; exit 1; }
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
node whatsapp_bot/prepare_whatsapp_runtime_v76.js || { log "ERROR: WhatsApp runtime V76 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v77.js || { log "ERROR: WhatsApp runtime V77 preparation failed."; exit 1; }
node whatsapp_bot/prepare_whatsapp_runtime_v78.js || { log "ERROR: WhatsApp runtime V78 verification failed."; exit 1; }

node --check whatsapp_bot/index.js || { log "ERROR: WhatsApp source syntax check failed."; exit 1; }

node --input-type=module -e 'import fs from "node:fs"; const s=fs.readFileSync("whatsapp_bot/index.js","utf8"); const required=["WHATSAPP_RUNTIME_FIX_V77","sendInteractiveMessage(sock, jid","name: \"quick_reply\"","name: \"single_select\"","zqbaileys_helper"]; for (const x of required) { if (!s.includes(x)) throw new Error(`WhatsApp V77 runtime verification failed: ${x}`); } const start=s.indexOf("async function buttons(sock, jid, text, items)"); const end=s.indexOf("async function home(sock, jid)", start + 1); if (start < 0 || end < 0 || end <= start) throw new Error("WhatsApp V77 runtime verification failed: active transport block not found"); const active=s.slice(start,end); const forbidden=["buttons: clean.map(x => ({ buttonId:","buttonText: { displayText:","await sock.sendMessage(jid, { title: \"🍬 Sweet & Snacks\"","interactiveMessage: {"]; for (const x of forbidden) { if (active.includes(x)) throw new Error(`WhatsApp V77 runtime verification failed: forbidden transport ${x}`); } console.log("WhatsApp V77 helper interactive transport verification passed");' || { log "ERROR: WhatsApp runtime verification failed."; exit 1; }

log "WhatsApp pairing mode: PHONE PAIRING CODE ONLY (QR DISABLED)."
log "WhatsApp runtime V61 + V62 + V63 + V64 + V67 + V68 + V69 + V70 + V71 + V72 + V73 + V76 + V77 + V78 enabled."
log "WhatsApp interactive button fix is active: helper low-level Native Flow relay; no Django/business/action logic changes."

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
