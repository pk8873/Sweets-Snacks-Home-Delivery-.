from django.contrib import admin

from .models import Category, Product, Favorite


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "emoji", "active", "created_at")
    list_filter = ("active", "created_at")
    search_fields = ("name", "description")
    list_editable = ("emoji", "active")
    readonly_fields = ("created_at",)
    ordering = ("name",)

    fieldsets = (
        (
            "Category",
            {"fields": ("name", "description", "image", "emoji", "active")},
        ),
        (
            "Timestamps",
            {"fields": ("created_at",)},
        ),
    )


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "name", "category", "price", "selling_unit", "price_quantity_label",
        "stock_display", "available", "created_at",
    )
    list_filter = ("category", "selling_unit", "available", "created_at")
    search_fields = ("name", "description", "category__name")
    list_editable = ("price", "selling_unit", "available")
    readonly_fields = ("created_at", "updated_at", "unit_label", "price_quantity_label", "stock_display")
    fieldsets = (
        ("Product Information", {"fields": ("name", "category", "description", "image")}),
        (
            "Price & Selling Unit",
            {
                "description": "Use Pieces/Packs for countable items. Use Grams or Kilograms for weight products.",
                "fields": ("price", "selling_unit", "weight_grams", "unit_label", "price_quantity_label"),
            },
        ),
        (
            "Inventory",
            {
                "description": "For Pieces/Packs use Stock. For Grams/Kilograms use Stock (grams).",
                "fields": ("stock", "stock_grams", "stock_display", "available"),
            },
        ),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )
    ordering = ("-created_at",)


@admin.register(Favorite)
class FavoriteAdmin(admin.ModelAdmin):
    list_display = ("customer", "product", "created_at")
    list_filter = ("created_at",)
    search_fields = ("customer__name", "customer__telegram_username", "product__name")
    readonly_fields = ("customer", "product", "created_at")
    ordering = ("-created_at",)
