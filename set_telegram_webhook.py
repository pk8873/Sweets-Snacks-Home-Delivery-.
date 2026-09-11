import asyncio
import os

from telegram import Bot


SERVICE_URL = "https://sweets-snacks-home-delivery-3.onrender.com"


async def main():
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()

    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")

    # Render provides RENDER_EXTERNAL_URL automatically. Keep the known
    # production URL as a safe fallback so webhook setup cannot silently fail.
    base_url = (
        os.getenv("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
        or SERVICE_URL
    )

    webhook_url = (
        os.getenv("TELEGRAM_WEBHOOK_URL", "").strip()
        or f"{base_url}/telegram/webhook/"
    )

    print(f"Configuring Telegram webhook: {webhook_url}")

    bot = Bot(token=token)

    try:
        await bot.initialize()

        result = await bot.set_webhook(
            url=webhook_url,
            secret_token=secret or None,
            drop_pending_updates=False,
            allowed_updates=["message", "callback_query"],
        )

        print(f"Telegram setWebhook result: {result}")

        info = await bot.get_webhook_info()
        print(f"Telegram webhook URL: {info.url}")
        print(f"Pending updates: {info.pending_update_count}")
        print(f"Last error date: {info.last_error_date}")
        print(f"Last error message: {info.last_error_message}")

        if info.url != webhook_url:
            raise RuntimeError(
                "Telegram webhook verification failed: "
                f"expected={webhook_url}, actual={info.url}"
            )

    finally:
        await bot.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
