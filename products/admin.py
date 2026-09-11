from django.contrib import admin

from .models import Category, Product, Favorite


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "active",
        "created_at",
    )

    list_filter = (
        "active",
        "created_at",
    )

    search_fields = (
        "name",
        "description",
    )

    list_editable = (
        "active",
    )

    readonly_fields = (
        "created_at",
    )

    ordering = (
        "name",
    )


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "category",
        "price",
        "stock",
        "available",
        "created_at",
        "updated_at",
    )

    list_filter = (
        "category",
        "available",
        "created_at",
    )

    search_fields = (
        "name",
        "description",
        "category__name",
    )

    list_editable = (
        "price",
        "stock",
        "available",
    )

    readonly_fields = (
        "created_at",
        "updated_at",
    )

    fieldsets = (
        (
            "Product Information",
            {
                "fields": (
                    "name",
                    "category",
                    "description",
                    "image",
                )
            },
        ),
        (
            "Price & Stock",
            {
                "fields": (
                    "price",
                    "stock",
                    "available",
                )
            },
        ),
        (
            "Timestamps",
            {
                "fields": (
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )

    ordering = (
        "-created_at",
    )


@admin.register(Favorite)
class FavoriteAdmin(admin.ModelAdmin):
    list_display = (
        "customer",
        "product",
        "created_at",
    )

    list_filter = (
        "created_at",
    )

    search_fields = (
        "customer__name",
        "customer__telegram_username",
        "product__name",
    )

    readonly_fields = (
        "customer",
        "product",
        "created_at",
    )

    ordering = (
        "-created_at",
    )
