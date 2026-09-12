from asgiref.sync import async_to_sync
from django.contrib import admin, messages

from notifications.services import send_telegram_notification

from .models import Order, OrderItem


def notify_orders(order_ids, status):
    for order_id in order_ids:
        try:
            async_to_sync(send_telegram_notification)(order_id, status)
        except Exception:
            # A notification failure must never block the admin order update.
            continue


@admin.action(description="✅ Confirm selected orders")
def confirm_orders(modeladmin, request, queryset):
    ids = list(queryset.exclude(order_status="confirmed").values_list("id", flat=True))
    updated = queryset.exclude(order_status="confirmed").update(order_status="confirmed")
    notify_orders(ids, "confirmed")
    modeladmin.message_user(request, f"{updated} order(s) confirmed and customers notified.", messages.SUCCESS)


@admin.action(description="👨‍🍳 Mark as Preparing")
def prepare_orders(modeladmin, request, queryset):
    ids = list(queryset.exclude(order_status="preparing").values_list("id", flat=True))
    updated = queryset.exclude(order_status="preparing").update(order_status="preparing")
    notify_orders(ids, "preparing")
    modeladmin.message_user(request, f"{updated} order(s) marked as preparing and customers notified.", messages.SUCCESS)


@admin.action(description="📦 Mark as Ready")
def ready_orders(modeladmin, request, queryset):
    ids = list(queryset.exclude(order_status="ready").values_list("id", flat=True))
    updated = queryset.exclude(order_status="ready").update(order_status="ready")
    notify_orders(ids, "ready")
    modeladmin.message_user(request, f"{updated} order(s) marked as ready and customers notified.", messages.SUCCESS)


@admin.action(description="🚚 Out for Delivery")
def out_for_delivery_orders(modeladmin, request, queryset):
    ids = list(queryset.exclude(order_status="out_for_delivery").values_list("id", flat=True))
    updated = queryset.exclude(order_status="out_for_delivery").update(order_status="out_for_delivery")
    notify_orders(ids, "out_for_delivery")
    modeladmin.message_user(request, f"{updated} order(s) out for delivery and customers notified.", messages.SUCCESS)


@admin.action(description="🎉 Mark as Delivered")
def delivered_orders(modeladmin, request, queryset):
    ids = list(queryset.exclude(order_status="delivered").values_list("id", flat=True))
    updated = queryset.exclude(order_status="delivered").update(order_status="delivered")
    notify_orders(ids, "delivered")
    modeladmin.message_user(request, f"{updated} order(s) delivered and customers notified.", messages.SUCCESS)


@admin.action(description="❌ Cancel selected orders")
def cancel_orders(modeladmin, request, queryset):
    ids = list(queryset.exclude(order_status="cancelled").values_list("id", flat=True))
    updated = queryset.exclude(order_status="cancelled").update(order_status="cancelled")
    notify_orders(ids, "cancelled")
    modeladmin.message_user(request, f"{updated} order(s) cancelled and customers notified.", messages.WARNING)


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    fields = ("product", "product_name", "quantity", "quantity_grams", "price", "subtotal")
    readonly_fields = ("product", "product_name", "quantity", "quantity_grams", "price", "subtotal")


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        "order_id", "customer_name", "phone", "total_amount",
        "payment_method", "payment_status", "order_status", "created_at",
    )
    list_filter = ("payment_method", "payment_status", "order_status", "created_at")
    search_fields = (
        "order_id", "customer_name", "phone",
        "customer__name", "customer__telegram_username",
    )
    list_editable = ("payment_status", "order_status")
    readonly_fields = (
        "order_id", "customer", "customer_name", "phone", "address",
        "subtotal", "delivery_charge", "discount", "total_amount",
        "created_at", "updated_at",
    )
    fieldsets = (
        ("Customer Information", {"fields": ("customer", "customer_name", "phone", "address")}),
        ("Delivery Information", {"fields": ("delivery_slot",)}),
        ("Order Amount", {"fields": ("subtotal", "delivery_charge", "discount", "total_amount")}),
        ("Payment", {"fields": ("payment_method", "payment_status")}),
        ("Order Status", {"fields": ("order_status",)}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )
    inlines = [OrderItemInline]
    actions = [confirm_orders, prepare_orders, ready_orders, out_for_delivery_orders, delivered_orders, cancel_orders]
    ordering = ("-created_at",)
    date_hierarchy = "created_at"

    def save_model(self, request, obj, form, change):
        previous_status = None
        if change and obj.pk:
            previous_status = Order.objects.filter(pk=obj.pk).values_list("order_status", flat=True).first()

        super().save_model(request, obj, form, change)

        if change and previous_status != obj.order_status:
            notify_orders([obj.id], obj.order_status)
            self.message_user(
                request,
                "Customer Telegram tracking notification sent/queued.",
                messages.INFO,
            )


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = ("id", "order", "product_name", "quantity", "quantity_grams", "price", "subtotal")
    search_fields = ("product_name", "product__name", "order__order_id", "order__customer_name", "order__phone")
    readonly_fields = ("order", "product", "product_name", "quantity", "quantity_grams", "price", "subtotal")
    ordering = ("-id",)
