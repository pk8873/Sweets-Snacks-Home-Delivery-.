from decimal import Decimal

from django.db import models

from customers.models import Customer
from products.models import Product


class Cart(models.Model):

    customer = models.OneToOneField(
        Customer,
        on_delete=models.CASCADE,
        related_name="cart"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Cart"
        verbose_name_plural = "Carts"
        ordering = ["-updated_at"]

    def __str__(self):
        return f"Cart - {self.customer.name}"

    @property
    def total_items(self):
        return sum(item.quantity for item in self.items.all())

    @property
    def subtotal(self):
        return sum(
            (item.subtotal for item in self.items.all()),
            Decimal("0.00")
        )


class CartItem(models.Model):

    cart = models.ForeignKey(
        Cart,
        on_delete=models.CASCADE,
        related_name="items"
    )

    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        related_name="cart_items"
    )

    # Number of pieces/packs. For weight products this is the number of
    # selected-weight packs, while quantity_grams stores grams per pack.
    quantity = models.PositiveIntegerField(default=1)

    # Used only for weight-based products. Example: 250, 500, 750, 1000.
    quantity_grams = models.PositiveIntegerField(default=0)

    price = models.DecimalField(max_digits=10, decimal_places=2)

    subtotal = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=0
    )

    class Meta:
        verbose_name = "Cart Item"
        verbose_name_plural = "Cart Items"
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["cart", "product"],
                name="unique_product_per_cart"
            )
        ]

    def __str__(self):
        if self.product.is_weight_based and self.quantity_grams:
            return f"{self.product.name} x {self.quantity} × {self.quantity_grams}g"
        return f"{self.product.name} x {self.quantity}"

    def save(self, *args, **kwargs):
        if self.price is None:
            self.price = self.product.price

        if self.product.is_weight_based and self.quantity_grams:
            base_weight = max(self.product.weight_grams, 1)
            self.subtotal = (
                self.price
                * Decimal(self.quantity_grams)
                / Decimal(base_weight)
                * Decimal(self.quantity)
            )
        else:
            self.subtotal = self.price * self.quantity

        super().save(*args, **kwargs)
