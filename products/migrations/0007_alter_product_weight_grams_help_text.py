from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0006_alter_product_weight_help_text"),
    ]

    operations = [
        migrations.AlterField(
            model_name="product",
            name="weight_grams",
            field=models.PositiveIntegerField(
                default=1000,
                help_text="Base weight in grams for the listed price.",
            ),
        ),
    ]
