from django import forms
from django.core.exceptions import ValidationError

from .models import Category, Product


class SafeImageFormMixin:
    MAX_IMAGE_SIZE = 5 * 1024 * 1024

    def clean_image(self):
        image = self.cleaned_data.get("image")
        if image and getattr(image, "size", 0) > self.MAX_IMAGE_SIZE:
            raise ValidationError("Image is too large. Please use an image up to 5 MB.")
        return image


class CategoryAdminForm(SafeImageFormMixin, forms.ModelForm):
    class Meta:
        model = Category
        fields = "__all__"

    def clean_name(self):
        name = " ".join((self.cleaned_data.get("name") or "").split())
        if not name:
            raise ValidationError("Category name is required.")
        qs = Category.objects.filter(name__iexact=name)
        if self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise ValidationError("A category with this name already exists.")
        return name

    def clean_emoji(self):
        return (self.cleaned_data.get("emoji") or "").strip()


class ProductAdminForm(SafeImageFormMixin, forms.ModelForm):
    class Meta:
        model = Product
        fields = "__all__"

    def clean_name(self):
        return " ".join((self.cleaned_data.get("name") or "").split())

    def clean_price(self):
        price = self.cleaned_data.get("price")
        if price is not None and price <= 0:
            raise ValidationError("Price must be greater than 0.")
        return price

    def clean_weight_grams(self):
        value = self.cleaned_data.get("weight_grams")
        if value is not None and value <= 0:
            raise ValidationError("Base weight must be greater than 0 grams.")
        return value
