from django.db import migrations, models


PIECE_KEYWORDS = (
    "burger",
    "samosa",
    "jalebi",
    "gulab jamun",
    "gulabjamun",
    "kachori",
    "momo",
    "momos",
    "pizza",
    "sandwich",
    "roll",
    "spring roll",
    "puff",
    "patty",
    "pastry",
    "cupcake",
    "cake slice",
    "bottle",
    "water",
    "juice",
    "lassi",
    "cold drink",
    "soft drink",
    "tea",
    "coffee",
    "plate",
)


def forwards(apps, schema_editor):
    Product = apps.get_model("products", "Product")
    db_alias = schema_editor.connection.alias

    for product in Product.objects.using(db_alias).all().iterator():
        name = (product.name or "").strip().lower()

        if not product.is_weight_based:
            unit = "pcs"
        elif any(keyword in name for keyword in PIECE_KEYWORDS):
            # Common countable foods should never be forced into grams.
            unit = "pcs"
        elif int(product.weight_grams or 0) == 1000:
            unit = "kg"
        else:
            unit = "g"

        product.selling_unit = unit
        product.is_weight_based = unit in {"g", "kg"}
        if unit == "kg":
            product.weight_grams = 1000
        product.save(update_fields=["selling_unit", "is_weight_based", "weight_grams"])


def backwards(apps, schema_editor):
    Product = apps.get_model("products", "Product")
    db_alias = schema_editor.connection.alias

    for product in Product.objects.using(db_alias).all().iterator():
        product.is_weight_based = product.selling_unit in {"g", "kg"}
        if product.selling_unit == "kg":
            product.weight_grams = 1000
        product.save(update_fields=["is_weight_based", "weight_grams"])


class Migration(migrations.Migration):

    dependencies = [
        ("products", "0003_product_weight_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="product",
            name="selling_unit",
            field=models.CharField(
                choices=[
                    ("pcs", "Pieces / Packs"),
                    ("g", "Grams"),
                    ("kg", "Kilograms"),
                ],
                default="pcs",
                help_text=(
                    "Choose Pieces/Packs for countable products; "
                    "Grams or Kilograms for weight products."
                ),
                max_length=10,
            ),
        ),
        migrations.RunPython(forwards, backwards),
    ]
