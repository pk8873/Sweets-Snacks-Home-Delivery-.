from django.contrib import admin

from .models import Payment


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):

    list_display = (
        "order",
        "gateway",
        "amount",
        "status",
        "gateway_order_id",
        "gateway_payment_id",
        "created_at",
        "paid_at",
    )

    list_filter = (
        "gateway",
        "status",
        "created_at",
        "paid_at",
    )

    search_fields = (
        "order__order_id",
        "order__customer_name",
        "transaction_id",
        "gateway_order_id",
        "gateway_payment_id",
    )

    readonly_fields = (
        "order",
        "gateway",
        "transaction_id",
        "amount",
        "status",
        "gateway_order_id",
        "gateway_payment_id",
        "gateway_signature",
        "created_at",
        "paid_at",
        "updated_at",
    )

    ordering = (
        "-created_at",
    )

    date_hierarchy = "created_at"