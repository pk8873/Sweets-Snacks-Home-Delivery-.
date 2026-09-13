from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0005_category_emoji"),
    ]

    operations = [
        migrations.AlterField(
            model_name="product",
            name="is_weight_based",
            field=models.BooleanField(
                default=False,
                help_text="Compatibility flag; automatically synchronized from selling_unit.",
            ),
        ),
        migrations.AlterField(
            model_name="product",
            name="stock_grams",
            field=models.PositiveIntegerField(
                default=0,
                help_text="Available weight stock in grams for Grams/Kilograms products.",
            ),
        ),
    ]
