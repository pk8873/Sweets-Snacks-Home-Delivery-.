from decimal import Decimal

from asgiref.sync import sync_to_async

from .services import create_order_async


@sync_to_async
def get_checkout_data(
    customer_id,
    address_id,
    delivery_charge=Decimal("0.00"),
    discount=Decimal("0.00"),
):
    from cart.models import Cart

    cart = (
        Cart.objects
        .prefetch_related("items__product")
        .filter(customer_id=customer_id)
        .first()
    )

    if not cart:
        raise ValueError("Cart not found.")

    items = list(cart.items.all())

    if not items:
        raise ValueError("Cart is empty.")

    subtotal = Decimal("0.00")

    for item in items:
        subtotal += (
            item.product.price
            * item.quantity
        )

    total = (
        subtotal
        + Decimal(delivery_charge or 0)
        - Decimal(discount or 0)
    )

    if total < 0:
        total = Decimal("0.00")

    return {
        "items": items,
        "subtotal": subtotal,
        "delivery_charge": Decimal(
            delivery_charge or 0
        ),
        "discount": Decimal(
            discount or 0
        ),
        "total": total,
    }


async def checkout_cod(
    customer_id,
    address_id,
    delivery_charge=Decimal("0.00"),
    discount=Decimal("0.00"),
    delivery_slot="",
):
    order = await create_order_async(
        customer_id=customer_id,
        address_id=address_id,
        payment_method="cod",
        delivery_slot=delivery_slot,
        delivery_charge=delivery_charge,
        discount=discount,
    )

    return order