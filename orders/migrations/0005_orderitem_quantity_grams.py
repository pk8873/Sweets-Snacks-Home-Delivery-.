from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0004_alter_order_order_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="orderitem",
            name="quantity_grams",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
