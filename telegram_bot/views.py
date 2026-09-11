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
    # SECRET TOKEN
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
            "Invalid Telegram webhook JSON."
        )

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

            logger.error(
                "Telegram returned invalid update."
            )

            return JsonResponse(
                {
                    "status": "error",
                    "message": "Invalid Telegram update.",
                },
                status=400,
            )

        logger.info(
            "Telegram update received: update_id=%s",
            update.update_id,
        )

        # ====================================================
        # PROCESS UPDATE DIRECTLY
        # ====================================================

        await application.process_update(
            update
        )

        logger.info(
            "Telegram update processed: update_id=%s",
            update.update_id,
        )

        return JsonResponse(
            {
                "status": "ok",
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