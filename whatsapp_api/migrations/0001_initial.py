from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("customers", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="WhatsAppContact",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("wa_id", models.CharField(max_length=64, unique=True)),
                ("display_name", models.CharField(blank=True, max_length=150)),
                ("phone", models.CharField(blank=True, max_length=20)),
                ("state", models.CharField(default="main", max_length=40)),
                ("state_data", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("customer", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="whatsapp_contact", to="customers.customer")),
            ],
            options={
                "verbose_name": "WhatsApp Contact",
                "verbose_name_plural": "WhatsApp Contacts",
                "ordering": ["-updated_at"],
            },
        ),
    ]
