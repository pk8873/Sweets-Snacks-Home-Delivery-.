from decimal import Decimal

from django.db import models

from customers.models import Customer
from products.models import Product


class Order(models.Model):

    PAYMENT_METHOD_CHOICES = [
        ("cod", "Cash on Delivery"),
        ("online", "Online Payment"),
    ]

    PAYMENT_STATUS_CHOICES = [
        ("pending", "Pending"),
        ("paid", "Paid"),
        ("failed", "Failed"),
        ("refunded", "Refunded"),
    ]

    ORDER_STATUS_CHOICES = [
        ("pending", "Order Received"),
        ("confirmed", "Confirmed"),
        ("preparing", "Preparing"),
        ("ready", "Ready"),
        ("out_for_delivery", "Out for Delivery"),
        ("delivered", "Delivered"),
        ("cancelled", "Cancelled"),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="orders")
    order_id = models.CharField(max_length=30, unique=True, null=True, blank=True)
    customer_name = models.CharField(max_length=150)
    phone = models.CharField(max_length=15, blank=True)
    address = models.TextField()
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    delivery_charge = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default="cod")
    payment_status = models.CharField(max_length=20, choices=PAYMENT_STATUS_CHOICES, default="pending")
    order_status = models.CharField(max_length=30, choices=ORDER_STATUS_CHOICES, default="pending")
    delivery_slot = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Order"
        verbose_name_plural = "Orders"
        ordering = ["-created_at"]

    def __str__(self):
        return self.order_id


class OrderItem(models.Model):

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="order_items")
    product_name = models.CharField(max_length=200)
    quantity = models.PositiveIntegerField(default=1)
    quantity_grams = models.PositiveIntegerField(default=0)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        verbose_name = "Order Item"
        verbose_name_plural = "Order Items"
        ordering = ["id"]

    def __str__(self):
        if self.quantity_grams:
            return f"{self.product_name} x {self.quantity} × {self.quantity_grams}g"
        return f"{self.product_name} x {self.quantity}"

    def save(self, *args, **kwargs):
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
