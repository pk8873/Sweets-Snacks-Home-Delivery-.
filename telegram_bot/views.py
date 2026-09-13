import json
import logging

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from telegram import Update

from .bot import initialize_telegram_application
from .ux import apply as apply_telegram_ux


logger = logging.getLogger(__name__)
_ux_applied = False


def ensure_telegram_ux():
    global _ux_applied
    if not _ux_applied:
        apply_telegram_ux()
        _ux_applied = True


@csrf_exempt
async def telegram_webhook(request):
    """Receive and immediately process Telegram webhook updates."""

    if request.method != "POST":
        return JsonResponse(
            {"status": "error", "message": "Only POST is allowed."},
            status=405,
        )

    configured_secret = getattr(settings, "TELEGRAM_WEBHOOK_SECRET", "").strip()
    if configured_secret:
        received_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if received_secret != configured_secret:
            logger.warning("Telegram webhook rejected: invalid secret token.")
            return JsonResponse({"status": "error", "message": "Unauthorized."}, status=403)

    try:
        data = json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.exception("Telegram webhook received invalid JSON.")
        return JsonResponse({"status": "error", "message": "Invalid JSON."}, status=400)

    try:
        ensure_telegram_ux()
        application = await initialize_telegram_application()
        update = Update.de_json(data=data, bot=application.bot)
        if update is None:
            logger.error("Telegram webhook received an invalid Update.")
            return JsonResponse({"status": "error", "message": "Invalid Telegram update."}, status=400)

        callback_data = update.callback_query.data if update.callback_query else None
        logger.info(
            "TELEGRAM UPDATE RECEIVED: update_id=%s message=%s callback=%s callback_data=%s",
            update.update_id,
            bool(update.message),
            bool(update.callback_query),
            callback_data,
        )
        await application.process_update(update)
        logger.info("TELEGRAM UPDATE PROCESSED SUCCESSFULLY: update_id=%s", update.update_id)
        return JsonResponse({"status": "ok"})
    except Exception:
        logger.exception("TELEGRAM WEBHOOK PROCESSING FAILED.")
        return JsonResponse({"status": "error", "message": "Webhook processing failed."}, status=500)
