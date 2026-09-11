from django.contrib import admin

from .models import Cart, CartItem


class CartItemInline(admin.TabularInline):
    model = CartItem

    extra = 0

    fields = (
        "product",
        "quantity",
        "price",
        "subtotal",
    )

    readonly_fields = (
        "subtotal",
    )


@admin.register(Cart)
class CartAdmin(admin.ModelAdmin):
    list_display = (
        "customer",
        "total_items_display",
        "subtotal_display",
        "updated_at",
    )

    search_fields = (
        "customer__name",
        "customer__phone",
        "customer__telegram_username",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )

    inlines = [
        CartItemInline,
    ]

    ordering = (
        "-updated_at",
    )

    @admin.display(description="Total Items")
    def total_items_display(self, obj):
        return obj.total_items

    @admin.display(description="Subtotal")
    def subtotal_display(self, obj):
        return f"₹{obj.subtotal}"