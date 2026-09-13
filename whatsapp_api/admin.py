from django.contrib import admin

from .models import WhatsAppContact


@admin.register(WhatsAppContact)
class WhatsAppContactAdmin(admin.ModelAdmin):
    list_display = ("display_name", "wa_id", "customer", "state", "updated_at")
    search_fields = ("display_name", "wa_id", "phone", "customer__name")
    list_filter = ("state",)
    readonly_fields = ("created_at", "updated_at")
