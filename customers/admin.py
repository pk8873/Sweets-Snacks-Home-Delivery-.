from django.contrib import admin

from .models import Customer, CustomerAddress


class CustomerAddressInline(admin.TabularInline):
    model = CustomerAddress

    extra = 0

    fields = (
        "label",
        "address",
        "city",
        "pincode",
        "is_default",
        "created_at",
    )

    readonly_fields = (
        "created_at",
    )


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "phone",
        "telegram_username",
        "language",
        "created_at",
    )

    list_filter = (
        "language",
        "created_at",
    )

    search_fields = (
        "name",
        "phone",
        "telegram_username",
        "telegram_user_id",
    )

    readonly_fields = (
        "telegram_user_id",
        "created_at",
        "updated_at",
    )

    fieldsets = (
        (
            "Customer Information",
            {
                "fields": (
                    "name",
                    "phone",
                    "language",
                )
            },
        ),
        (
            "Telegram",
            {
                "fields": (
                    "telegram_user_id",
                    "telegram_username",
                )
            },
        ),
        (
            "Timestamps",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )

    inlines = [
        CustomerAddressInline,
    ]

    ordering = (
        "-created_at",
    )


@admin.register(CustomerAddress)
class CustomerAddressAdmin(admin.ModelAdmin):
    list_display = (
        "customer",
        "label",
        "city",
        "pincode",
        "is_default",
        "created_at",
    )

    list_filter = (
        "label",
        "is_default",
        "city",
    )

    search_fields = (
        "customer__name",
        "customer__phone",
        "address",
        "city",
        "pincode",
    )

    readonly_fields = (
        "created_at",
    )

    ordering = (
        "-created_at",
    )