from django.db import models

from customers.models import Customer


class WhatsAppContact(models.Model):
    customer = models.OneToOneField(
        Customer,
        on_delete=models.CASCADE,
        related_name="whatsapp_contact",
    )
    wa_id = models.CharField(max_length=64, unique=True)
    display_name = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    state = models.CharField(max_length=40, default="main")
    state_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "WhatsApp Contact"
        verbose_name_plural = "WhatsApp Contacts"

    def __str__(self):
        return self.display_name or self.wa_id
