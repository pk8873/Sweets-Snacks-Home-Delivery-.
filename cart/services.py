from decimal import Decimal

from asgiref.sync import sync_to_async

from .models import Cart, CartItem


@sync_to_async
def get_customer_cart(customer_id):
    cart, _ = Cart.objects.get_or_create(
        customer_id=customer_id
    )

    items = list(
        cart.items
        .select_related("product")
        .all()
    )

    subtotal = sum(
        (
            item.product.price
            * item.quantity
            for item in items
        ),
        Decimal("0.00"),
    )

    total_items = sum(
        item.quantity
        for item in items
    )

    return {
        "cart": cart,
        "items": items,
        "subtotal": subtotal,
        "total_items": total_items,
    }


@sync_to_async
def add_to_cart(
    customer_id,
    product_id,
    quantity=1,
):
    from products.models import Product

    product = Product.objects.get(
        id=product_id
    )

    if not product.available:
        raise ValueError(
            "Product is unavailable."
        )

    cart, _ = Cart.objects.get_or_create(
        customer_id=customer_id
    )

    cart_item, _ = CartItem.objects.get_or_create(
        cart=cart,
        product=product,
        defaults={
            "quantity": 0,
            "price": product.price,
        },
    )

    new_quantity = (
        cart_item.quantity
        + quantity
    )

    if new_quantity > product.stock:
        raise ValueError(
            f"Only {product.stock} available."
        )

    cart_item.quantity = new_quantity
    cart_item.price = product.price
    cart_item.save()

    return cart_item
