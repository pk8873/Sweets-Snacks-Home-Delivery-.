from django.db import transaction
from django.utils import timezone

from .models import Payment


@transaction.atomic
def create_pending_payment(
    order,
    gateway_order_id,
):
    payment, created = Payment.objects.get_or_create(
        order=order,
        defaults={
            "gateway": "razorpay",
            "amount": order.total_amount,
            "status": "pending",
            "gateway_order_id": gateway_order_id,
        },
    )

    if not created:
        payment.amount = order.total_amount
        payment.gateway_order_id = gateway_order_id
        payment.status = "pending"

        payment.save(
            update_fields=[
                "amount",
                "gateway_order_id",
                "status",
                "updated_at",
            ]
        )

    return payment


@transaction.atomic
def mark_payment_paid(
    payment,
    payment_id,
    signature,
):
    payment.transaction_id = payment_id
    payment.gateway_payment_id = payment_id
    payment.gateway_signature = signature
    payment.status = "paid"
    payment.paid_at = timezone.now()

    payment.save(
        update_fields=[
            "transaction_id",
            "gateway_payment_id",
            "gateway_signature",
            "status",
            "paid_at",
            "updated_at",
        ]
    )

    payment.order.payment_status = "paid"
    payment.order.order_status = "confirmed"

    payment.order.save(
        update_fields=[
            "payment_status",
            "order_status",
            "updated_at",
        ]
    )

    return payment


@transaction.atomic
def mark_payment_failed(payment):
    payment.status = "failed"

    payment.save(
        update_fields=[
            "status",
            "updated_at",
        ]
    )

    payment.order.payment_status = "failed"

    payment.order.save(
        update_fields=[
            "payment_status",
            "updated_at",
        ]
    )

    return payment


@transaction.atomic
def mark_payment_refunded(payment):
    payment.status = "refunded"

    payment.save(
        update_fields=[
            "status",
            "updated_at",
        ]
    )

    payment.order.payment_status = "refunded"

    payment.order.save(
        update_fields=[
            "payment_status",
            "updated_at",
        ]
    )

    return payment