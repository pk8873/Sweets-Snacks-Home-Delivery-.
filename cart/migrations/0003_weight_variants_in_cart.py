from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("cart", "0002_cartitem_quantity_grams")]

    operations = [
        migrations.RemoveConstraint(
            model_name="cartitem",
            name="unique_product_per_cart",
        ),
        migrations.AddConstraint(
            model_name="cartitem",
            constraint=models.UniqueConstraint(
                fields=["cart", "product", "quantity_grams"],
                name="unique_product_weight_per_cart",
            ),
        ),
    ]
