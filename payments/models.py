# payments/models.py

from django.db import models


class Payment(models.Model):

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("paid", "Paid"),
        ("failed", "Failed"),
        ("refunded", "Refunded"),
    ]

    order = models.OneToOneField(
        "orders.Order",
        on_delete=models.PROTECT,
        related_name="payment",
    )

    gateway = models.CharField(
        max_length=50,
        default="razorpay",
    )

    transaction_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        unique=True,
    )

    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="pending",
    )

    gateway_order_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        unique=True,
    )

    gateway_payment_id = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        unique=True,
    )

    gateway_signature = models.CharField(
        max_length=500,
        blank=True,
        null=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    paid_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        verbose_name = "Payment"
        verbose_name_plural = "Payments"
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"{self.order.order_id} - "
            f"{self.status}"
        )
