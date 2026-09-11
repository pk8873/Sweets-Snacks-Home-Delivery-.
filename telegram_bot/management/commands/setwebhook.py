import requests

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):

    help = "Set Telegram bot webhook"

    def handle(
        self,
        *args,
        **options,
    ):

        token = getattr(
            settings,
            "TELEGRAM_BOT_TOKEN",
            "",
        ).strip()

        secret = getattr(
            settings,
            "TELEGRAM_WEBHOOK_SECRET",
            "",
        ).strip()

        if not token:

            self.stdout.write(
                self.style.ERROR(
                    "TELEGRAM_BOT_TOKEN is missing."
                )
            )

            return

        if not secret:

            self.stdout.write(
                self.style.ERROR(
                    "TELEGRAM_WEBHOOK_SECRET is missing."
                )
            )

            return

        webhook_url = (
            "https://sweets-snacks-home-delivery-3"
            ".onrender.com"
            "/telegram/webhook/"
        )

        api_url = (
            "https://api.telegram.org/"
            f"bot{token}/setWebhook"
        )

        payload = {
            "url": webhook_url,
            "secret_token": secret,
            "drop_pending_updates": True,
            "allowed_updates": [
                "message",
                "callback_query",
            ],
        }

        try:

            response = requests.post(
                api_url,
                json=payload,
                timeout=30,
            )

            response.raise_for_status()

            data = response.json()

            if data.get("ok"):

                self.stdout.write(
                    self.style.SUCCESS(
                        "Telegram webhook configured successfully."
                    )
                )

                self.stdout.write(
                    f"Webhook URL: {webhook_url}"
                )

            else:

                self.stdout.write(
                    self.style.ERROR(
                        f"Telegram API error: {data}"
                    )
                )

        except requests.RequestException as exc:

            self.stdout.write(
                self.style.ERROR(
                    f"Webhook request failed: {exc}"
                )
            )