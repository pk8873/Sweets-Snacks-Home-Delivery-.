import asyncio

from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver

from orders.models import Order


@receiver(pre_save, sender=Order)
def order_pre_save(sender, instance, **kwargs):
    if not instance.pk:
        instance._old_order_status = None
        return

    try:
        old_order = sender.objects.get(
            pk=instance.pk
        )

        instance._old_order_status = (
            old_order.order_status
        )

    except sender.DoesNotExist:
        instance._old_order_status = None


@receiver(post_save, sender=Order)
def order_post_save(
    sender,
    instance,
    created,
    **kwargs,
):
    old_status = getattr(
        instance,
        "_old_order_status",
        None,
    )

    new_status = instance.order_status

    # New order
    if created:

        try:
            from notifications.services import (
                send_telegram_notification
            )

            asyncio.run(
                send_telegram_notification(
                    instance.pk,
                    new_status,
                )
            )

        except Exception as error:
            print(
                "Notification error:",
                error,
            )

        return

    # Status has not changed
    if old_status == new_status:
        return

    try:
        from notifications.services import (
            send_telegram_notification
        )

        asyncio.run(
            send_telegram_notification(
                instance.pk,
                new_status,
            )
        )

    except Exception as error:
        print(
            "Notification error:",
            error,
        )