from asgiref.sync import sync_to_async
from django.conf import settings
from django.utils import timezone
from telegram import Bot

from .messages import get_status_message


@sync_to_async
def get_order_notification_data(order_id):
    from orders.models import Order

    order = (
        Order.objects
        .select_related("customer")
        .filter(id=order_id)
        .first()
    )

    if not order:
        return None

    return {
        "telegram_user_id": order.customer.telegram_user_id,
        "language": order.customer.language,
        "order_id": order.order_id,
        "order_status": order.order_status,
    }


@sync_to_async
def create_notification_record(
    order_id,
    notification_type,
    message,
):
    from orders.models import Order
    from .models import Notification

    order = Order.objects.filter(id=order_id).first()

    if not order:
        return None

    notification = Notification.objects.create(
        order=order,
        channel="telegram",
        notification_type=notification_type,
        message=message,
        status="pending",
    )

    return notification.id


@sync_to_async
def mark_notification_sent(notification_id):
    from .models import Notification

    notification = Notification.objects.filter(
        id=notification_id
    ).first()

    if notification:
        notification.status = "sent"
        notification.sent_at = timezone.now()

        notification.save(
            update_fields=[
                "status",
                "sent_at",
            ]
        )


@sync_to_async
def mark_notification_failed(
    notification_id,
    error_message,
):
    from .models import Notification

    notification = Notification.objects.filter(
        id=notification_id
    ).first()

    if notification:
        notification.status = "failed"
        notification.error_message = str(error_message)

        notification.save(
            update_fields=[
                "status",
                "error_message",
            ]
        )


async def send_telegram_notification(
    order_id,
    status=None,
):
    token = getattr(
        settings,
        "TELEGRAM_BOT_TOKEN",
        "",
    )

    if not token:
        print(
            "ERROR: TELEGRAM_BOT_TOKEN is empty."
        )
        return False

    data = await get_order_notification_data(
        order_id
    )

    if not data:
        print(
            f"ERROR: Order not found: {order_id}"
        )
        return False

    if status is None:
        status = data["order_status"]

    message = get_status_message(
        data["order_id"],
        status,
        data["language"],
    )

    notification_id = (
        await create_notification_record(
            order_id,
            status,
            message,
        )
    )

    if not notification_id:
        return False

    try:
        bot = Bot(token=token)

        await bot.send_message(
            chat_id=data["telegram_user_id"],
            text=message,
        )

        await mark_notification_sent(
            notification_id
        )

        print(
            f"Telegram notification sent: "
            f"{data['order_id']} - {status}"
        )

        return True

    except Exception as error:

        print(
            "Telegram API error:",
            error,
        )

        await mark_notification_failed(
            notification_id,
            error,
        )

        return False