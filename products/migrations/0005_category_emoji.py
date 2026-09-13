from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("products", "0004_product_selling_unit")]

    operations = [
        migrations.AddField(
            model_name="category",
            name="emoji",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Optional emoji for Telegram category buttons, e.g. 🍰 or 🥟.",
                max_length=8,
            ),
        ),
    ]
