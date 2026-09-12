from django.contrib import admin, messages

from .models import Order, OrderItem


@admin.action(description="✅ Confirm selected orders")
def confirm_orders(modeladmin, request, queryset):
    updated = queryset.exclude(order_status="confirmed").update(order_status="confirmed")
    modeladmin.message_user(request, f"{updated} order(s) confirmed.", messages.SUCCESS)


@admin.action(description="👨‍🍳 Mark as Preparing")
def prepare_orders(modeladmin, request, queryset):
    updated = queryset.exclude(order_status="preparing").update(order_status="preparing")
    modeladmin.message_user(request, f"{updated} order(s) marked as preparing.", messages.SUCCESS)


@admin.action(description="📦 Mark as Ready")
def ready_orders(modeladmin, request, queryset):
    updated = queryset.exclude(order_status="ready").update(order_status="ready")
    modeladmin.message_user(request, f"{updated} order(s) marked as ready.", messages.SUCCESS)


@admin.action(description="🚚 Out for Delivery")
def out_for_delivery_orders(modeladmin, request, queryset):
    updated = queryset.exclude(order_status="out_for_delivery").update(order_status="out_for_delivery")
    modeladmin.message_user(request, f"{updated} order(s) out for delivery.", messages.SUCCESS)


@admin.action(description="🎉 Mark as Delivered")
def delivered_orders(modeladmin, request, queryset):
    updated = queryset.exclude(order_status="delivered").update(order_status="delivered")
    modeladmin.message_user(request, f"{updated} order(s) delivered.", messages.SUCCESS)


@admin.action(description="❌ Cancel selected orders")
def cancel_orders(modeladmin, request, queryset):
    updated = queryset.exclude(order_status="cancelled").update(order_status="cancelled")
    modeladmin.message_user(request, f"{updated} order(s) cancelled.", messages.WARNING)


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


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = ("id", "order", "product_name", "quantity", "quantity_grams", "price", "subtotal")
    search_fields = ("product_name", "product__name", "order__order_id", "order__customer_name", "order__phone")
    readonly_fields = ("order", "product", "product_name", "quantity", "quantity_grams", "price", "subtotal")
    ordering = ("-id",)
