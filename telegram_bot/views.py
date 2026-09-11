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

    if request.method != "POST":
        return JsonResponse(
            {
                "status": "error",
                "message": "Only POST is allowed.",
            },
            status=405,
        )

    # ========================================================
    # TELEGRAM SECRET TOKEN CHECK
    # ========================================================

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
            logger.warning(
                "Invalid Telegram webhook secret."
            )

            return JsonResponse(
                {
                    "status": "error",
                    "message": "Unauthorized.",
                },
                status=403,
            )

    # ========================================================
    # JSON
    # ========================================================

    try:
        body = request.body.decode(
            "utf-8"
        )

        data = json.loads(body)

    except (
        json.JSONDecodeError,
        UnicodeDecodeError,
    ):
        return JsonResponse(
            {
                "status": "error",
                "message": "Invalid JSON.",
            },
            status=400,
        )

    # ========================================================
    # TELEGRAM UPDATE
    # ========================================================

    try:

        application = (
            await initialize_telegram_application()
        )

        update = Update.de_json(
            data,
            application.bot,
        )

        if update is None:
            return JsonResponse(
                {
                    "status": "error",
                    "message": "Invalid Telegram update.",
                },
                status=400,
            )

        # Process Telegram update
        await application.process_update(
            update
        )

        return JsonResponse(
            {
                "status": "ok"
            },
            status=200,
        )

    except Exception:
        logger.exception(
            "Telegram webhook processing failed."
        )

        return JsonResponse(
            {
                "status": "error",
                "message": "Webhook processing failed.",
            },
            status=500,
        )