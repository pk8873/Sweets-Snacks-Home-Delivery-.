# delivery/models.py

from django.db import models


class DeliveryZone(models.Model):

    name = models.CharField(
        max_length=100,
        unique=True,
    )

    minimum_distance = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        help_text="Minimum distance in kilometers",
    )

    maximum_distance = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        help_text="Maximum distance in kilometers",
    )

    charge = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0,
    )

    active = models.BooleanField(
        default=True,
    )

    created_at = models.DateTimeField(
        auto_now_add=True,
    )

    updated_at = models.DateTimeField(
        auto_now=True,
    )

    class Meta:
        verbose_name = "Delivery Zone"
        verbose_name_plural = "Delivery Zones"
        ordering = ["minimum_distance"]

    def __str__(self):
        return (
            f"{self.name} "
            f"({self.minimum_distance} - "
            f"{self.maximum_distance} km)"
        )