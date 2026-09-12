from django.db import models

from customers.models import Customer


class Category(models.Model):

    name = models.CharField(
        max_length=100,
        unique=True
    )

    description = models.TextField(
        blank=True
    )

    image = models.ImageField(
        upload_to="categories/",
        blank=True,
        null=True
    )

    active = models.BooleanField(
        default=True
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    class Meta:
        verbose_name = "Category"
        verbose_name_plural = "Categories"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Product(models.Model):

    category = models.ForeignKey(
        Category,
        on_delete=models.CASCADE,
        related_name="products"
    )

    name = models.CharField(
        max_length=200
    )

    description = models.TextField(
        blank=True
    )

    price = models.DecimalField(
        max_digits=10,
        decimal_places=2
    )

    image = models.ImageField(
        upload_to="products/",
        blank=True,
        null=True
    )

    available = models.BooleanField(
        default=True
    )

    # Normal products use stock as number of pieces/packs.
    stock = models.PositiveIntegerField(
        default=0
    )

    # Weight-based products use these fields. Price is for weight_grams.
    is_weight_based = models.BooleanField(
        default=False,
        help_text="Enable for products sold by weight, such as sweets or namkeen."
    )

    weight_grams = models.PositiveIntegerField(
        default=1000,
        help_text="Base weight in grams for the listed price, e.g. 1000 for a 1 kg price."
    )

    stock_grams = models.PositiveIntegerField(
        default=0,
        help_text="Available stock in grams for weight-based products."
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    updated_at = models.DateTimeField(
        auto_now=True
    )

    class Meta:
        verbose_name = "Product"
        verbose_name_plural = "Products"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class Favorite(models.Model):

    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="favorites"
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="favorites"
    )

    created_at = models.DateTimeField(
        auto_now_add=True
    )

    class Meta:
        verbose_name = "Favorite"
        verbose_name_plural = "Favorites"

        constraints = [
            models.UniqueConstraint(
                fields=[
                    "customer",
                    "product",
                ],
                name="unique_customer_product_favorite",
            )
        ]

        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"{self.customer.name} - "
            f"{self.product.name}"
        )
