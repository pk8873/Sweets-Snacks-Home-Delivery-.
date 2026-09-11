import asyncio

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from telegram import Bot


class Command(BaseCommand):
    help = "Configure the Telegram bot webhook for the current deployment."

    def handle(self, *args, **options):
        token = getattr(settings, "TELEGRAM_BOT_TOKEN", "").strip()
        secret = getattr(settings, "TELEGRAM_WEBHOOK_SECRET", "").strip()
        explicit_url = getattr(settings, "TELEGRAM_WEBHOOK_URL", "").strip()
        hostname = getattr(settings, "RENDER_EXTERNAL_HOSTNAME", "").strip()

        if not token:
            raise CommandError("TELEGRAM_BOT_TOKEN is not configured.")

        webhook_url = explicit_url
        if not webhook_url and hostname:
            webhook_url = f"https://{hostname}/telegram/webhook/"

        if not webhook_url:
            raise CommandError(
                "Telegram webhook URL is not configured. "
                "Set TELEGRAM_WEBHOOK_URL or RENDER_EXTERNAL_HOSTNAME."
            )

        asyncio.run(self.set_webhook(token, webhook_url, secret))

    async def set_webhook(self, token, webhook_url, secret):
        bot = Bot(token=token)

        try:
            await bot.initialize()
            result = await bot.set_webhook(
                url=webhook_url,
                secret_token=secret or None,
                drop_pending_updates=True,
                allowed_updates=["message", "callback_query"],
            )

            if not result:
                raise CommandError("Telegram rejected the webhook configuration.")

            self.stdout.write(
                self.style.SUCCESS(
                    f"Telegram webhook configured: {webhook_url}"
                )
            )
        finally:
            await bot.shutdown()
