from django.contrib import admin

from .models import DeliveryZone


@admin.register(DeliveryZone)
class DeliveryZoneAdmin(admin.ModelAdmin):

    list_display = (
        "name",
        "minimum_distance",
        "maximum_distance",
        "charge",
        "active",
        "created_at",
    )

    list_filter = (
        "active",
        "created_at",
    )

    search_fields = (
        "name",
    )

    list_editable = (
        "charge",
        "active",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )

    fieldsets = (
        (
            "Delivery Zone",
            {
                "fields": (
                    "name",
                    "minimum_distance",
                    "maximum_distance",
                    "charge",
                    "active",
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

    ordering = (
        "minimum_distance",
    )