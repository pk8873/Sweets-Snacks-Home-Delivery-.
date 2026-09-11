import requests

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):

    help = "Delete Telegram bot webhook"

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

        if not token:

            self.stdout.write(
                self.style.ERROR(
                    "TELEGRAM_BOT_TOKEN is missing."
                )
            )

            return

        api_url = (
            "https://api.telegram.org/"
            f"bot{token}/deleteWebhook"
        )

        try:

            response = requests.post(
                api_url,
                json={
                    "drop_pending_updates": True
                },
                timeout=30,
            )

            response.raise_for_status()

            data = response.json()

            if data.get("ok"):

                self.stdout.write(
                    self.style.SUCCESS(
                        "Telegram webhook deleted."
                    )
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
                    f"Request failed: {exc}"
                )
            )