from django.db import models


class Notification(models.Model):
    CHANNEL_CHOICES = [
        ("telegram", "Telegram"),
    ]

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("sent", "Sent"),
        ("failed", "Failed"),
    ]

    order = models.ForeignKey(
        "orders.Order",
        on_delete=models.CASCADE,
        related_name="notifications",
    )

    channel = models.CharField(
        max_length=30,
        choices=CHANNEL_CHOICES,
        default="telegram",
    )

    notification_type = models.CharField(
        max_length=50,
    )

    message = models.TextField()

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="pending",
    )

    error_message = models.TextField(
        blank=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    sent_at = models.DateTimeField(
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"{self.order.order_id} - "
            f"{self.notification_type}"
        )