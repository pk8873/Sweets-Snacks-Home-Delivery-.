import json
import os
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.http import FileResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from cart.models import Cart, CartItem
from customers.models import Customer, CustomerAddress
from orders.models import Order
from orders.services import create_order
from payments.services import create_razorpay_order
from products.models import Category, Product

from .models import WhatsAppContact


BOT_SECRET = os.getenv("WHATSAPP_BOT_SECRET", "").strip()


def _authorized(request):
    if not BOT_SECRET:
        return False
    return request.headers.get("X-WhatsApp-Bot-Secret", "") == BOT_SECRET


def _json(request):
    try:
        return json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return {}


def _error(message, status=400):
    return JsonResponse({"ok": False, "error": message}, status=status)


def _contact(data):
    wa_id = str(data.get("wa_id") or "").strip()
    if not wa_id:
        raise ValueError("wa_id is required.")

    display_name = str(data.get("display_name") or "Customer").strip()[:150]
    phone = str(data.get("phone") or wa_id).strip()[:15]

    contact = WhatsAppContact.objects.select_related("customer").filter(wa_id=wa_id).first()
    if contact:
        changed = False
        if display_name and contact.display_name != display_name:
            contact.display_name = display_name
            changed = True
        if phone and contact.phone != phone:
            contact.phone = phone
            changed = True
        customer = contact.customer
        if display_name and customer.name != display_name:
            customer.name = display_name
            customer.save(update_fields=["name", "updated_at"])
        if phone and customer.phone != phone:
            customer.phone = phone
            customer.save(update_fields=["phone", "updated_at"])
        if changed:
            contact.save(update_fields=["display_name", "phone", "updated_at"])
        return contact

    customer = Customer.objects.create(
        telegram_user_id=None,
        name=display_name or "Customer",
        phone=phone,
        language="hi",
    )
    return WhatsAppContact.objects.create(
        customer=customer,
        wa_id=wa_id,
        display_name=display_name,
        phone=phone,
    )


def _product_data(request, product):
    image_url = None
    if product.image:
        image_url = request.build_absolute_uri(f"/whatsapp/api/products/{product.id}/image/")
    return {
        "id": product.id,
        "name": product.name,
        "description": product.description,
        "price": str(product.price),
        "selling_unit": product.selling_unit,
        "is_weight_based": product.is_weight_based,
        "weight_grams": product.weight_grams,
        "stock": product.stock,
        "stock_grams": product.stock_grams,
        "available": product.available,
        "price_quantity_label": product.price_quantity_label,
        "stock_display": product.stock_display,
        "image_url": image_url,
        "category": product.category.name,
        "category_emoji": product.category.emoji or "",
    }


@csrf_exempt
def api(request, action="menu"):
    if not _authorized(request):
        return _error("Unauthorized.", 401)

    data = _json(request) if request.method != "GET" else request.GET.dict()

    try:
        if action == "menu":
            categories = Category.objects.filter(active=True).order_by("name")
            return JsonResponse({
                "ok": True,
                "categories": [
                    {"id": c.id, "name": c.name, "emoji": c.emoji or "🍽️"}
                    for c in categories
                ],
            })

        if action == "products":
            category_id = int(data.get("category_id"))
            products = Product.objects.filter(
                category_id=category_id,
                available=True,
            ).select_related("category").order_by("name")
            return JsonResponse({"ok": True, "products": [_product_data(request, p) for p in products]})

        if action == "customer":
            contact = _contact(data)
            address = contact.customer.addresses.filter(is_default=True).first()
            return JsonResponse({
                "ok": True,
                "customer": {
                    "id": contact.customer_id,
                    "name": contact.customer.name,
                    "phone": contact.customer.phone or contact.phone,
                    "language": contact.customer.language,
                },
                "contact": {"wa_id": contact.wa_id},
                "address": None if not address else {
                    "id": address.id,
                    "address": address.address,
                    "city": address.city,
                    "pincode": address.pincode,
                },
            })

        if action == "cart":
            contact = _contact(data)
            cart, _ = Cart.objects.get_or_create(customer=contact.customer)
            items = list(cart.items.select_related("product").all())
            return JsonResponse({
                "ok": True,
                "items": [
                    {
                        "id": item.id,
                        "product_id": item.product_id,
                        "name": item.product.name,
                        "quantity": item.quantity,
                        "quantity_grams": item.quantity_grams,
                        "price": str(item.price),
                        "subtotal": str(item.subtotal),
                        "is_weight_based": item.product.is_weight_based,
                    }
                    for item in items
                ],
                "subtotal": str(cart.subtotal),
                "total_items": cart.total_items,
            })

        if action == "cart/add":
            contact = _contact(data)
            product = Product.objects.get(id=int(data["product_id"]), available=True)
            quantity = max(int(data.get("quantity", 1)), 1)
            quantity_grams = int(data.get("quantity_grams", 0) or 0)
            if product.is_weight_based:
                if quantity_grams not in {250, 500, 750, 1000} and quantity_grams != product.weight_grams:
                    raise ValueError("Invalid weight selection.")
                if quantity_grams > product.stock_grams:
                    raise ValueError(f"Only {product.stock_grams}g available.")
            else:
                quantity_grams = 0
                if quantity > product.stock:
                    raise ValueError(f"Only {product.stock} available.")

            cart, _ = Cart.objects.get_or_create(customer=contact.customer)
            item, created = CartItem.objects.get_or_create(
                cart=cart,
                product=product,
                quantity_grams=quantity_grams,
                defaults={"quantity": 0, "price": product.price},
            )
            new_quantity = item.quantity + quantity
            if product.is_weight_based:
                if new_quantity * quantity_grams > product.stock_grams:
                    raise ValueError(f"Only {product.stock_grams}g available.")
            elif new_quantity > product.stock:
                raise ValueError(f"Only {product.stock} available.")
            item.quantity = new_quantity
            item.price = product.price
            item.save()
            return JsonResponse({"ok": True, "message": "Added to cart.", "cart_item_id": item.id})

        if action == "cart/remove":
            contact = _contact(data)
            CartItem.objects.filter(id=int(data["cart_item_id"]), cart__customer=contact.customer).delete()
            return JsonResponse({"ok": True})

        if action == "address":
            contact = _contact(data)
            address_text = str(data.get("address") or "").strip()
            city = str(data.get("city") or "").strip()[:100]
            pincode = str(data.get("pincode") or "").strip()[:10]
            if not address_text or not city or not pincode:
                raise ValueError("Address, city and pincode are required.")
            CustomerAddress.objects.filter(customer=contact.customer, is_default=True).update(is_default=False)
            address = CustomerAddress.objects.create(
                customer=contact.customer,
                label="home",
                address=address_text,
                city=city,
                pincode=pincode,
                is_default=True,
            )
            return JsonResponse({"ok": True, "address_id": address.id})

        if action == "checkout":
            contact = _contact(data)
            address_id = int(data.get("address_id") or 0)
            if not address_id:
                address = contact.customer.addresses.filter(is_default=True).first()
                if not address:
                    raise ValueError("Please save a delivery address first.")
                address_id = address.id
            payment_method = str(data.get("payment_method") or "cod").lower()
            if payment_method not in {"cod", "online"}:
                raise ValueError("Invalid payment method.")
            order = create_order(
                customer_id=contact.customer_id,
                address_id=address_id,
                payment_method=payment_method,
                delivery_charge=Decimal("0.00"),
                discount=Decimal("0.00"),
            )
            result = {
                "ok": True,
                "order_id": order.order_id,
                "total": str(order.total_amount),
                "payment_method": payment_method,
                "payment_status": order.payment_status,
            }
            if payment_method == "online":
                try:
                    payment, gateway = create_razorpay_order(order)
                    result["payment_url"] = request.build_absolute_uri(f"/payments/telegram/{order.order_id}/")
                    result["gateway_order_id"] = gateway["id"]
                    result["payment_id"] = payment.id
                except Exception as exc:
                    order.payment_status = "failed"
                    order.save(update_fields=["payment_status", "updated_at"])
                    result["payment_url"] = None
                    result["payment_error"] = str(exc)
            return JsonResponse(result)

        if action == "orders":
            contact = _contact(data)
            orders = Order.objects.filter(customer=contact.customer).prefetch_related("items")[:10]
            return JsonResponse({
                "ok": True,
                "orders": [
                    {
                        "order_id": o.order_id,
                        "created_at": o.created_at.isoformat(),
                        "total": str(o.total_amount),
                        "status": o.order_status,
                        "payment_status": o.payment_status,
                        "payment_method": o.payment_method,
                    }
                    for o in orders
                ],
            })

        if action == "order":
            contact = _contact(data)
            order = Order.objects.filter(
                customer=contact.customer,
                order_id=str(data.get("order_id") or ""),
            ).prefetch_related("items").first()
            if not order:
                raise ValueError("Order not found.")
            return JsonResponse({
                "ok": True,
                "order": {
                    "order_id": order.order_id,
                    "created_at": order.created_at.isoformat(),
                    "total": str(order.total_amount),
                    "subtotal": str(order.subtotal),
                    "delivery_charge": str(order.delivery_charge),
                    "status": order.order_status,
                    "payment_status": order.payment_status,
                    "payment_method": order.payment_method,
                    "address": order.address,
                    "items": [
                        {
                            "name": i.product_name,
                            "quantity": i.quantity,
                            "quantity_grams": i.quantity_grams,
                            "subtotal": str(i.subtotal),
                        }
                        for i in order.items.all()
                    ],
                },
            })

        return _error("Unknown action.", 404)

    except (ValueError, KeyError, Category.DoesNotExist, Product.DoesNotExist):
        return _error("Invalid request or unavailable item.")
    except Exception as exc:
        return _error(str(exc), 500)


@csrf_exempt
def product_image(request, product_id):
    if not _authorized(request):
        return _error("Unauthorized.", 401)
    product = Product.objects.filter(id=product_id).first()
    if not product or not product.image:
        return _error("Image not found.", 404)
    try:
        path = Path(product.image.path)
        if not path.exists():
            return _error("Image file is missing.", 404)
        return FileResponse(open(path, "rb"), content_type="image/jpeg")
    except Exception:
        return _error("Image could not be opened.", 404)
