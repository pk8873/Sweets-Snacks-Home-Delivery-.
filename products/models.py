from django.db import models

from customers.models import Customer


class Category(models.Model):

    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to="categories/", blank=True, null=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Category"
        verbose_name_plural = "Categories"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Product(models.Model):

    SELLING_UNIT_CHOICES = [
        ("pcs", "Pieces / Packs"),
        ("g", "Grams"),
        ("kg", "Kilograms"),
    ]

    category = models.ForeignKey(
        Category,
        on_delete=models.CASCADE,
        related_name="products"
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    image = models.ImageField(upload_to="products/", blank=True, null=True)
    available = models.BooleanField(default=True)

    # For piece/pack products, stock is the number of sellable pieces/packs.
    stock = models.PositiveIntegerField(default=0)

    # Explicit selling unit: pieces/packs, grams, or kilograms.
    # This is now the source of truth for how the customer buys the product.
    selling_unit = models.CharField(
        max_length=10,
        choices=SELLING_UNIT_CHOICES,
        default="pcs",
        help_text="Choose Pieces/Packs for countable products; Grams or Kilograms for weight products."
    )

    # Kept for backward compatibility with the existing cart/order/bot code.
    is_weight_based = models.BooleanField(
        default=False,
        help_text="Compatibility flag; automatically synchronized from selling_unit."
    )

    # Weight products use weight_grams as the base quantity for the listed price.
    # Example: selling_unit=kg, weight_grams=1000, price=400 means ₹400/kg.
    weight_grams = models.PositiveIntegerField(
        default=1000,
        help_text="Base weight in grams for the listed price."
    )

    # Weight-product inventory is stored in grams.
    stock_grams = models.PositiveIntegerField(
        default=0,
        help_text="Available weight stock in grams for Grams/Kilograms products."
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Product"
        verbose_name_plural = "Products"
        ordering = ["-created_at"]

    @property
    def is_piece_based(self):
        return self.selling_unit == "pcs"

    @property
    def unit_label(self):
        return dict(self.SELLING_UNIT_CHOICES).get(self.selling_unit, "Pieces / Packs")

    @property
    def price_quantity_label(self):
        if self.selling_unit == "kg":
            return "1 kg"
        if self.selling_unit == "g":
            return f"{max(int(self.weight_grams or 1), 1)} g"
        return "1 pc"

    @property
    def stock_display(self):
        if self.selling_unit == "kg":
            return f"{self.stock_grams / 1000:g} kg"
        if self.selling_unit == "g":
            return f"{self.stock_grams} g"
        return f"{self.stock} pcs"

    def save(self, *args, **kwargs):
        # Keep the legacy boolean synchronized so existing Telegram/cart/order
        # logic continues to work without treating every product as weight-based.
        self.is_weight_based = self.selling_unit in {"g", "kg"}
        if self.selling_unit == "kg":
            self.weight_grams = 1000
        elif self.selling_unit == "pcs":
            self.weight_grams = max(int(self.weight_grams or 1000), 1)
            self.stock_grams = 0
        super().save(*args, **kwargs)

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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Favorite"
        verbose_name_plural = "Favorites"
        constraints = [
            models.UniqueConstraint(
                fields=["customer", "product"],
                name="unique_customer_product_favorite",
            )
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.customer.name} - {self.product.name}"
