#!/usr/bin/env bash
set -e

python manage.py collectstatic --no-input
python manage.py migrate
python manage.py check
python create_admin.py
python set_telegram_webhook.py

node whatsapp_bot/index.js &
NODE_PID=$!

cleanup() {
  kill "$NODE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec gunicorn config.asgi:application -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT
