from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0002_favorite"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="is_weight_based",
            field=models.BooleanField(
                default=False,
                help_text="Enable for products sold by weight, such as sweets or namkeen.",
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="weight_grams",
            field=models.PositiveIntegerField(
                default=1000,
                help_text="Base weight in grams for the listed price, e.g. 1000 for a 1 kg price.",
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="stock_grams",
            field=models.PositiveIntegerField(
                default=0,
                help_text="Available stock in grams for weight-based products.",
            ),
        ),
    ]
