import asyncio
import os

from django.core.management.base import BaseCommand, CommandError
from telegram import Bot


SERVICE_URL = "https://sweets-snacks-home-delivery-3.onrender.com"


class Command(BaseCommand):
    help = "Configure and verify the Telegram bot webhook."

    def handle(self, *args, **options):
        try:
            asyncio.run(self._configure_webhook())
        except Exception as exc:
            raise CommandError(str(exc)) from exc

    async def _configure_webhook(self):
        token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()

        if not token:
            raise RuntimeError(
                "TELEGRAM_BOT_TOKEN is not configured."
            )

        base_url = (
            os.getenv("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
            or SERVICE_URL
        )

        webhook_url = (
            os.getenv("TELEGRAM_WEBHOOK_URL", "").strip()
            or f"{base_url}/telegram/webhook/"
        )

        self.stdout.write(
            self.style.NOTICE(
                f"Configuring Telegram webhook: {webhook_url}"
            )
        )

        bot = Bot(token=token)

        try:
            await bot.initialize()

            result = await bot.set_webhook(
                url=webhook_url,
                secret_token=secret or None,
                drop_pending_updates=False,
                allowed_updates=["message", "callback_query"],
            )

            self.stdout.write(
                self.style.SUCCESS(
                    f"Telegram setWebhook result: {result}"
                )
            )

            info = await bot.get_webhook_info()

            self.stdout.write(
                f"Telegram webhook URL: {info.url}"
            )
            self.stdout.write(
                f"Pending updates: {info.pending_update_count}"
            )
            self.stdout.write(
                f"Last error date: {info.last_error_date}"
            )
            self.stdout.write(
                f"Last error message: {info.last_error_message}"
            )

            if info.url != webhook_url:
                raise RuntimeError(
                    "Telegram webhook verification failed: "
                    f"expected={webhook_url}, actual={info.url}"
                )

            if info.last_error_message:
                raise RuntimeError(
                    "Telegram reports a webhook delivery error: "
                    f"{info.last_error_message}"
                )

        finally:
            await bot.shutdown()
