#!/usr/bin/env bash

set -o errexit

python manage.py collectstatic --no-input

python manage.py migrate

python manage.py check

python manage.py check --deploy

python create_admin.py

python set_telegram_webhook.py
