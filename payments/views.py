from asgiref.sync import async_to_sync
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.http import require_GET, require_POST

from notifications.services import send_telegram_notification
from orders.models import Order

from .models import Payment
from .services import mark_payment_failed, mark_payment_paid, verify_payment_signature


@require_GET
def telegram_payment(request, order_id):
    order = get_object_or_404(
        Order.objects.select_related("customer"),
        order_id=order_id,
        payment_method="online",
    )
    payment = get_object_or_404(Payment, order=order)

    return render(
        request,
        "payments/telegram_payment.html",
        {
            "order": order,
            "payment": payment,
            "razorpay_key_id": settings.RAZORPAY_KEY_ID,
        },
    )


@require_POST
def telegram_payment_verify(request, order_id):
    order = get_object_or_404(Order, order_id=order_id, payment_method="online")
    payment = get_object_or_404(Payment, order=order)

    if payment.status == "paid":
        return JsonResponse({"ok": True, "status": "paid", "order_id": order.order_id})

    razorpay_order_id = (request.POST.get("razorpay_order_id") or "").strip()
    razorpay_payment_id = (request.POST.get("razorpay_payment_id") or "").strip()
    razorpay_signature = (request.POST.get("razorpay_signature") or "").strip()

    if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
        return JsonResponse({"ok": False, "message": "Payment response is incomplete."}, status=400)

    if razorpay_order_id != payment.gateway_order_id:
        mark_payment_failed(payment)
        return JsonResponse({"ok": False, "message": "Payment order mismatch."}, status=400)

    try:
        verify_payment_signature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        )
        mark_payment_paid(payment, razorpay_payment_id, razorpay_signature)
        async_to_sync(send_telegram_notification)(order.id, "confirmed")
        return JsonResponse({"ok": True, "status": "paid", "order_id": order.order_id})
    except Exception as exc:
        mark_payment_failed(payment)
        return JsonResponse({"ok": False, "message": f"Payment verification failed: {exc}"}, status=400)


@require_POST
def telegram_payment_failed(request, order_id):
    order = get_object_or_404(Order, order_id=order_id, payment_method="online")
    payment = get_object_or_404(Payment, order=order)
    if payment.status != "paid":
        mark_payment_failed(payment)
    return JsonResponse({"ok": True, "status": "failed"})
