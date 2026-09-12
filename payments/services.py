from decimal import Decimal

import razorpay
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import Payment


def razorpay_client():
    key_id = getattr(settings, "RAZORPAY_KEY_ID", "").strip()
    key_secret = getattr(settings, "RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not key_secret:
        raise RuntimeError("Razorpay keys are not configured.")
    return razorpay.Client(auth=(key_id, key_secret))


@transaction.atomic
def create_pending_payment(order, gateway_order_id):
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
        payment.save(update_fields=["amount", "gateway_order_id", "status", "updated_at"])

    return payment


@transaction.atomic
def create_razorpay_order(order):
    amount = int((Decimal(order.total_amount) * 100).quantize(Decimal("1")))
    if amount <= 0:
        raise ValueError("Order amount must be greater than zero.")

    client = razorpay_client()
    gateway_order = client.order.create(
        data={
            "amount": amount,
            "currency": "INR",
            "receipt": order.order_id,
            "notes": {"order_id": order.order_id},
        }
    )
    payment = create_pending_payment(order, gateway_order["id"])
    return payment, gateway_order


@transaction.atomic
def mark_payment_paid(payment, payment_id, signature):
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
    payment.order.save(update_fields=["payment_status", "order_status", "updated_at"])
    return payment


@transaction.atomic
def mark_payment_failed(payment):
    payment.status = "failed"
    payment.save(update_fields=["status", "updated_at"])
    payment.order.payment_status = "failed"
    payment.order.save(update_fields=["payment_status", "updated_at"])
    return payment


@transaction.atomic
def mark_payment_refunded(payment):
    payment.status = "refunded"
    payment.save(update_fields=["status", "updated_at"])
    payment.order.payment_status = "refunded"
    payment.order.save(update_fields=["payment_status", "updated_at"])
    return payment


def verify_payment_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
    client = razorpay_client()
    client.utility.verify_payment_signature(
        {
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_id": razorpay_payment_id,
            "razorpay_signature": razorpay_signature,
        }
    )
    return True
