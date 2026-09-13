from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("customers", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="customer",
            name="telegram_user_id",
            field=models.BigIntegerField(blank=True, null=True, unique=True),
        ),
    ]
