from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cart", "0001_initial"),
        ("products", "0003_product_weight_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="cartitem",
            name="quantity_grams",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
