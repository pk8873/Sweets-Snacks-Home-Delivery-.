from django.contrib import admin

from .models import Category, Product, Favorite


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "active", "created_at")
    list_filter = ("active", "created_at")
    search_fields = ("name", "description")
    list_editable = ("active",)
    readonly_fields = ("created_at",)
    ordering = ("name",)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "category",
        "price",
        "is_weight_based",
        "weight_grams",
        "stock",
        "stock_grams",
        "available",
        "created_at",
    )

    list_filter = (
        "category",
        "is_weight_based",
        "available",
        "created_at",
    )

    search_fields = ("name", "description", "category__name")

    list_editable = (
        "price",
        "is_weight_based",
        "weight_grams",
        "stock",
        "stock_grams",
        "available",
    )

    readonly_fields = ("created_at", "updated_at")

    fieldsets = (
        (
            "Product Information",
            {"fields": ("name", "category", "description", "image")},
        ),
        (
            "Price & Selling Unit",
            {
                "description": (
                    "Normal product: price is per piece/pack and stock is pieces/packs. "
                    "Weight product: price is for weight_grams and stock_grams is total available weight. "
                    "For example, set weight_grams=1000 and price=400 for ₹400/kg."
                ),
                "fields": (
                    "price",
                    "is_weight_based",
                    "weight_grams",
                    "stock",
                    "stock_grams",
                    "available",
                ),
            },
        ),
        (
            "Timestamps",
            {"fields": ("created_at", "updated_at")},
        ),
    )

    ordering = ("-created_at",)


@admin.register(Favorite)
class FavoriteAdmin(admin.ModelAdmin):
    list_display = ("customer", "product", "created_at")
    list_filter = ("created_at",)
    search_fields = ("customer__name", "customer__telegram_username", "product__name")
    readonly_fields = ("customer", "product", "created_at")
    ordering = ("-created_at",)
