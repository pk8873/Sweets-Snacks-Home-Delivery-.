from django.contrib import admin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):

    list_display = (
        "id",
        "order",
        "channel",
        "notification_type",
        "status",
        "created_at",
        "sent_at",
    )

    list_filter = (
        "channel",
        "status",
        "notification_type",
        "created_at",
    )

    search_fields = (
        "order__order_id",
        "notification_type",
        "message",
    )

    readonly_fields = (
        "order",
        "channel",
        "notification_type",
        "message",
        "status",
        "error_message",
        "created_at",
        "sent_at",
    )

    ordering = (
        "-created_at",
    )
