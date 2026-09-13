from django.db import models


class Customer(models.Model):

    LANGUAGE_CHOICES = [
        ("hi", "Hindi"),
        ("en", "English"),
    ]

    telegram_user_id = models.BigIntegerField(
        unique=True,
        null=True,
        blank=True,
    )

    telegram_username = models.CharField(
        max_length=150,
        blank=True,
        null=True
    )

    name = models.CharField(
        max_length=150
    )

    phone = models.CharField(
        max_length=15,
        blank=True,
        null=True
    )

    language = models.CharField(
        max_length=2,
        choices=LANGUAGE_CHOICES,
        default="hi"
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    updated_at = models.DateTimeField(
        auto_now=True
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Customer"
        verbose_name_plural = "Customers"

    def __str__(self):
        return self.name


class CustomerAddress(models.Model):

    LABEL_CHOICES = [
        ("home", "Home"),
        ("work", "Work"),
        ("other", "Other"),
    ]

    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="addresses"
    )

    label = models.CharField(
        max_length=20,
        choices=LABEL_CHOICES,
        default="home"
    )

    address = models.TextField()

    city = models.CharField(
        max_length=100
    )

    pincode = models.CharField(
        max_length=10
    )

    is_default = models.BooleanField(
        default=False
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    class Meta:
        ordering = ["-is_default", "-created_at"]
        verbose_name = "Customer Address"
        verbose_name_plural = "Customer Addresses"

    def __str__(self):
        return f"{self.customer.name} - {self.get_label_display()}"

