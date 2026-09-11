import asyncio
import os

from telegram import Bot


async def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()
    hostname = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()
    explicit_url = os.getenv("TELEGRAM_WEBHOOK_URL", "").strip()

    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")

    webhook_url = explicit_url or (
        f"https://{hostname}/telegram/webhook/" if hostname else ""
    )

    if not webhook_url:
        raise RuntimeError(
            "Set RENDER_EXTERNAL_HOSTNAME or TELEGRAM_WEBHOOK_URL"
        )

    bot = Bot(token=token)
    try:
        await bot.initialize()
        await bot.set_webhook(
            url=webhook_url,
            secret_token=secret or None,
            drop_pending_updates=False,
            allowed_updates=["message", "callback_query"],
        )
        info = await bot.get_webhook_info()
        print(f"Telegram webhook configured: {info.url}")
        print(f"Pending updates: {info.pending_update_count}")
        if info.last_error_message:
            print(f"Telegram last error: {info.last_error_message}")
    finally:
        await bot.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
