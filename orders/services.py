from decimal import Decimal
from datetime import datetime
import random

from asgiref.sync import sync_to_async
from django.db import transaction

from cart.models import Cart, CartItem
from customers.models import Customer, CustomerAddress
from orders.models import Order, OrderItem


def generate_order_id():
    date_part = datetime.now().strftime("%Y%m%d")
    random_part = str(random.randint(10000, 99999))

    return f"SS-{date_part}-{random_part}"


@transaction.atomic
def create_order(
    customer_id,
    address_id,
    payment_method="cod",
    delivery_slot="",
    delivery_charge=Decimal("0.00"),
    discount=Decimal("0.00"),
):
    customer = Customer.objects.get(
        id=customer_id
    )

    address = CustomerAddress.objects.get(
        id=address_id,
        customer=customer,
    )

    cart = (
        Cart.objects
        .select_related("customer")
        .prefetch_related("items__product")
        .get(customer=customer)
    )

    cart_items = list(cart.items.all())

    if not cart_items:
        raise ValueError("Cart is empty.")

    # Re-check stock and availability at checkout
    for cart_item in cart_items:

        product = cart_item.product

        if not product.available:
            raise ValueError(
                f"{product.name} is currently unavailable."
            )

        if product.stock < cart_item.quantity:
            raise ValueError(
                f"Only {product.stock} item(s) "
                f"of {product.name} are available."
            )

    subtotal = Decimal("0.00")

    for cart_item in cart_items:
        subtotal += (
            cart_item.product.price
            * cart_item.quantity
        )

    delivery_charge = Decimal(delivery_charge or 0)
    discount = Decimal(discount or 0)

    total_amount = (
        subtotal
        + delivery_charge
        - discount
    )

    if total_amount < 0:
        total_amount = Decimal("0.00")

    order = Order.objects.create(
        customer=customer,
        order_id=generate_order_id(),
        customer_name=customer.name,
        phone=customer.phone or "",
        address=(
            f"{address.address}, "
            f"{address.city}, "
            f"{address.pincode}"
        ),
        subtotal=subtotal,
        delivery_charge=delivery_charge,
        discount=discount,
        total_amount=total_amount,
        payment_method=payment_method,
        payment_status=(
            "pending"
            if payment_method == "online"
            else "pending"
        ),
        order_status="pending",
        delivery_slot=delivery_slot or "",
    )

    for cart_item in cart_items:

        product = cart_item.product

        current_price = product.price

        OrderItem.objects.create(
            order=order,
            product=product,
            product_name=product.name,
            quantity=cart_item.quantity,
            price=current_price,
            subtotal=(
                current_price
                * cart_item.quantity
            ),
        )

        # Reduce stock
        product.stock -= cart_item.quantity

        if product.stock <= 0:
            product.stock = 0
            product.available = False

        product.save(
            update_fields=[
                "stock",
                "available",
                "updated_at",
            ]
        )

    # Clear cart after successful order creation
    CartItem.objects.filter(
        cart=cart
    ).delete()

    return order


@sync_to_async
def create_order_async(
    customer_id,
    address_id,
    payment_method="cod",
    delivery_slot="",
    delivery_charge=Decimal("0.00"),
    discount=Decimal("0.00"),
):
    return create_order(
        customer_id=customer_id,
        address_id=address_id,
        payment_method=payment_method,
        delivery_slot=delivery_slot,
        delivery_charge=delivery_charge,
        discount=discount,
    )


@sync_to_async
def get_customer_orders(customer_id):
    return list(
        Order.objects
        .filter(customer_id=customer_id)
        .prefetch_related("items")
        .order_by("-created_at")
    )


@sync_to_async
def get_order_details(
    customer_id,
    order_id,
):
    order = (
        Order.objects
        .filter(
            customer_id=customer_id,
            order_id=order_id,
        )
        .prefetch_related("items")
        .first()
    )

    if not order:
        return None

    return {
        "order": order,
        "items": list(order.items.all()),
    }


@sync_to_async
def get_customer_order(
    customer_id,
    order_id,
):
    return (
        Order.objects
        .filter(
            customer_id=customer_id,
            order_id=order_id,
        )
        .prefetch_related("items")
        .first()
    )


@transaction.atomic
def reorder_order(
    customer_id,
    order_id,
):
    order = (
        Order.objects
        .filter(
            customer_id=customer_id,
            order_id=order_id,
        )
        .prefetch_related("items__product")
        .first()
    )

    if not order:
        raise ValueError(
            "Order not found."
        )

    customer = order.customer

    cart, _ = Cart.objects.get_or_create(
        customer=customer
    )

    added = []
    skipped = []

    for old_item in order.items.all():

        product = old_item.product

        if not product.available:
            skipped.append(
                f"{product.name} is unavailable."
            )
            continue

        if product.stock <= 0:
            skipped.append(
                f"{product.name} is out of stock."
            )
            continue

        cart_item, created = (
            CartItem.objects.get_or_create(
                cart=cart,
                product=product,
                defaults={
                    "quantity": 0,
                    "price": product.price,
                },
            )
        )

        new_quantity = (
            cart_item.quantity
            + old_item.quantity
        )

        if new_quantity > product.stock:
            skipped.append(
                f"{product.name}: only "
                f"{product.stock} available."
            )
            continue

        cart_item.quantity = new_quantity

        # Always use current product price
        cart_item.price = product.price

        cart_item.save()

        added.append(
            f"{product.name} x {old_item.quantity}"
        )

    return {
        "added": added,
        "skipped": skipped,
        "cart": cart,
    }


@sync_to_async
def build_order_tracking(order):
    status = order.order_status

    tracking = [
        ("pending", "🆕 Order Received"),
        ("confirmed", "✅ Confirmed"),
        ("preparing", "👨‍🍳 Preparing"),
        ("ready", "📦 Ready"),
        (
            "out_for_delivery",
            "🚚 Out for Delivery",
        ),
        ("delivered", "🎉 Delivered"),
    ]

    status_order = [
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "out_for_delivery",
        "delivered",
    ]

    if status == "cancelled":
        return {
            "status": "cancelled",
            "steps": [
                ("cancelled", "❌ Cancelled")
            ],
        }

    try:
        current_index = status_order.index(
            status
        )
    except ValueError:
        current_index = 0

    steps = []

    for index, (step, label) in enumerate(
        tracking
    ):
        if index < current_index:
            icon = "✅"
        elif index == current_index:
            icon = "🔵"
        else:
            icon = "⚪"

        steps.append(
            (
                step,
                f"{icon} {label}",
            )
        )

    return {
        "status": status,
        "steps": steps,
    }