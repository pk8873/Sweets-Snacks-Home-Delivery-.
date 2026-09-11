import json
import logging

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from telegram import Update

from .bot import (
    initialize_telegram_application,
)


logger = logging.getLogger(__name__)


@csrf_exempt
async def telegram_webhook(request):

    # ========================================================
    # METHOD
    # ========================================================

    if request.method != "POST":

        return JsonResponse(
            {
                "status": "error",
                "message": "Only POST is allowed.",
            },
            status=405,
        )

    # ========================================================
    # SECRET
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

        data = json.loads(
            request.body.decode(
                "utf-8"
            )
        )

    except (
        json.JSONDecodeError,
        UnicodeDecodeError,
    ):

        logger.exception(
            "Invalid webhook JSON."
        )

        return JsonResponse(
            {
                "status": "error",
                "message": "Invalid JSON.",
            },
            status=400,
        )

    # ========================================================
    # PROCESS
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

            logger.error(
                "Invalid Telegram update."
            )

            return JsonResponse(
                {
                    "status": "error",
                    "message": "Invalid Telegram update.",
                },
                status=400,
            )

        logger.info(
            "TELEGRAM UPDATE RECEIVED: %s",
            update.update_id,
        )

        await application.process_update(
            update
        )

        logger.info(
            "TELEGRAM UPDATE PROCESSED: %s",
            update.update_id,
        )

        return JsonResponse(
            {
                "status": "ok"
            }
        )

    except Exception:

        logger.exception(
            "TELEGRAM WEBHOOK FAILED."
        )

        return JsonResponse(
            {
                "status": "error",
                "message": "Webhook processing failed.",
            },
            status=500,
        )