#!/usr/bin/env bash
set -e

python manage.py collectstatic --no-input
python manage.py migrate
python manage.py check
python create_admin.py
python set_telegram_webhook.py

gunicorn config.asgi:application -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT &
WEB_PID=$!

cleanup() {
  kill "$WEB_PID" 2>/dev/null || true
  kill "$NODE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 3
node whatsapp_bot/index.js &
NODE_PID=$!

wait "$WEB_PID"
