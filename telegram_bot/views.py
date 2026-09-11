import json
import logging

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from telegram import Update

from .bot import initialize_telegram_application


logger = logging.getLogger(__name__)


@csrf_exempt
async def telegram_webhook(request):
    """Receive Telegram webhook updates and hand them to PTB."""

    if request.method != "POST":
        return JsonResponse(
            {"status": "error", "message": "Only POST is allowed."},
            status=405,
        )

    configured_secret = getattr(
        settings,
        "TELEGRAM_WEBHOOK_SECRET",
        "",
    ).strip()

    if configured_secret:
        received_secret = request.headers.get(
            "X-Telegram-Bot-Api-Secret-Token",
            "",
        )
        if received_secret != configured_secret:
            logger.warning("Invalid Telegram webhook secret.")
            return JsonResponse(
                {"status": "error", "message": "Unauthorized."},
                status=403,
            )

    try:
        data = json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.exception("Invalid Telegram webhook JSON.")
        return JsonResponse(
            {"status": "error", "message": "Invalid JSON."},
            status=400,
        )

    try:
        application = await initialize_telegram_application()
        update = Update.de_json(data=data, bot=application.bot)

        if update is None:
            logger.error("Telegram update could not be created.")
            return JsonResponse(
                {"status": "error", "message": "Invalid Telegram update."},
                status=400,
            )

        logger.info(
            "TELEGRAM WEBHOOK RECEIVED update_id=%s message=%s callback=%s data=%s",
            update.update_id,
            bool(update.message),
            bool(update.callback_query),
            update.callback_query.data if update.callback_query else None,
        )

        # The PTB Application is started once and consumes this queue in the
        # background. This is the pattern recommended for a custom webhook.
        await application.update_queue.put(update)

        return JsonResponse({"status": "ok"})

    except Exception:
        logger.exception("TELEGRAM WEBHOOK PROCESSING FAILED.")
        return JsonResponse(
            {"status": "error", "message": "Webhook processing failed."},
            status=500,
        )
