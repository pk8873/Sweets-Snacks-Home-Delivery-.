from django.core.management.base import BaseCommand

from telegram_bot.bot import run_bot


class Command(BaseCommand):

    help = "Run the Sweet Snacks Telegram bot"

    def handle(self, *args, **options):

        self.stdout.write(
            self.style.SUCCESS(
                "Starting Telegram bot..."
            )
        )

        run_bot()