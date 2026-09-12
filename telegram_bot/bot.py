import html
import logging
from decimal import Decimal, ROUND_HALF_UP
from urllib.parse import urlsplit

from asgiref.sync import sync_to_async
from django.conf import settings

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
)
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from cart.models import Cart, CartItem
from customers.models import Customer, CustomerAddress
from orders.services import (
    build_order_tracking,
    create_order_async,
    get_customer_orders,
    get_order_details,
    reorder_order,
)
from payments.services import create_razorpay_order
from products.models import Category, Favorite, Product

logger = logging.getLogger(__name__)
_application = None
_application_initialized = False
_application_started = False


# ============================================================
# TELEGRAM APPLICATION
# ============================================================


def get_telegram_application():
    global _application
    if _application is None:
        token = getattr(settings, "TELEGRAM_BOT_TOKEN", "").strip()
        if not token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured.")
        _application = Application.builder().token(token).updater(None).build()
        register_handlers(_application)
    return _application


async def initialize_telegram_application():
    global _application_initialized, _application_started
    application = get_telegram_application()
    if not _application_initialized:
        await application.initialize()
        _application_initialized = True
    if not _application_started:
        await application.start()
        _application_started = True
    return application


# ============================================================
# DISPLAY HELPERS
# ============================================================


def money(value):
    return f"₹{Decimal(value):,.2f}"


def weight_label(grams):
    grams = int(grams)
    return f"{grams // 1000} kg" if grams >= 1000 and grams % 1000 == 0 else f"{grams} g"


def weight_options(product):
    base = max(int(product.weight_grams or 1000), 250)
    values = [250, 500, 750, 1000]
    if base not in values:
        values.append(base)
    return sorted(v for v in set(values) if v <= base)


def price_for_weight(product, grams):
    base = max(int(product.weight_grams or 1000), 1)
    value = Decimal(product.price) * Decimal(int(grams)) / Decimal(base)
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def available(product):
    return product.stock_grams > 0 if product.is_weight_based else product.stock > 0


def price_text(product):
    if product.is_weight_based:
        return f"{money(price_for_weight(product, 250))} / 250 g"
    return money(product.price)


def stock_text(product):
    if product.is_weight_based:
        return f"📦 {weight_label(product.stock_grams)} available"
    return f"📦 {product.stock} available"


def category_icon(name):
    value = (name or "").lower()
    mapping = {
        "sweet": "🍰",
        "mithai": "🍬",
        "snack": "🥟",
        "namkeen": "🥨",
        "fast": "🍔",
        "burger": "🍔",
        "drink": "🥤",
        "beverage": "🥤",
        "combo": "🎁",
        "offer": "🔥",
        "special": "🔥",
        "cake": "🎂",
        "pizza": "🍕",
    }
    for key, icon in mapping.items():
        if key in value:
            return icon
    return "🍽️"


def safe(value):
    return html.escape(str(value or ""))


# ============================================================
# CUSTOMER
# ============================================================


@sync_to_async
def get_or_create_customer(user):
    customer, _ = Customer.objects.get_or_create(
        telegram_user_id=user.id,
        defaults={
            "telegram_username": user.username or "",
            "name": user.full_name or "Customer",
        },
    )
    changed = False
    if user.username and customer.telegram_username != user.username:
        customer.telegram_username = user.username
        changed = True
    if user.full_name and customer.name != user.full_name:
        customer.name = user.full_name
        changed = True
    if changed:
        customer.save(update_fields=["telegram_username", "name", "updated_at"])
    return customer


@sync_to_async
def get_customer(user_id):
    return Customer.objects.filter(telegram_user_id=user_id).first()


@sync_to_async
def set_language(user_id, language):
    customer = Customer.objects.get(telegram_user_id=user_id)
    customer.language = language
    customer.save(update_fields=["language", "updated_at"])
    return customer


@sync_to_async
def update_customer_phone(user_id, phone):
    customer = Customer.objects.get(telegram_user_id=user_id)
    customer.phone = phone[-15:]
    customer.save(update_fields=["phone", "updated_at"])
    return customer


# ============================================================
# MENUS
# ============================================================


def language_keyboard():
    return InlineKeyboardMarkup(
        [[
            InlineKeyboardButton("🇮🇳 हिंदी", callback_data="language_hi"),
            InlineKeyboardButton("🇬🇧 English", callback_data="language_en"),
        ]]
    )


def hindi_menu():
    return ReplyKeyboardMarkup(
        [
            ["🛍 दुकान देखें", "🔎 Search"],
            ["🛒 मेरी Cart", "❤️ Favorites"],
            ["📦 मेरे Orders", "📍 मेरा Address"],
            ["🌐 Language", "☎️ Help"],
        ],
        resize_keyboard=True,
        is_persistent=True,
    )


def english_menu():
    return ReplyKeyboardMarkup(
        [
            ["🛍 Shop", "🔎 Search"],
            ["🛒 My Cart", "❤️ Favorites"],
            ["📦 My Orders", "📍 My Address"],
            ["🌐 Language", "☎️ Help"],
        ],
        resize_keyboard=True,
        is_persistent=True,
    )


def address_contact_keyboard():
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("📱 Share Mobile Number", request_contact=True)],
            [KeyboardButton("📍 Share Location", request_location=True)],
            [KeyboardButton("✖️ Cancel")],
        ],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


async def send_menu(update, customer):
    if customer.language == "en":
        text = (
            f"🍬 <b>Welcome, {safe(customer.name)}!</b>\n\n"
            "Fresh sweets & snacks delivered to your door ❤️\n\n"
            "Choose an option below to continue."
        )
        markup = english_menu()
    else:
        text = (
            f"🍬 <b>{safe(customer.name)} जी, Sweet & Snacks में आपका स्वागत है!</b>\n\n"
            "ताज़ी मिठाई और snacks घर तक मंगाइए ❤️\n\n"
            "नीचे से अपना option चुनें।"
        )
        markup = hindi_menu()
    await update.effective_message.reply_text(text, parse_mode="HTML", reply_markup=markup)


async def start(update, context):
    try:
        user = update.effective_user
        if not user:
            return
        context.user_data.clear()
        customer = await get_or_create_customer(user)
        if not customer.language:
            await update.effective_message.reply_text(
                "🍬 <b>Sweet & Snacks</b>\n\n"
                "Fresh • Tasty • Delivered ❤️\n\n"
                "Welcome / स्वागत है!\nअपनी भाषा चुनें:",
                parse_mode="HTML",
                reply_markup=language_keyboard(),
            )
        else:
            await send_menu(update, customer)
    except Exception:
        logger.exception("START handler failed")
        await update.effective_message.reply_text("❌ कुछ गलत हुआ। कृपया /start फिर से भेजें।")


# ============================================================
# CATEGORIES + PRODUCTS
# ============================================================


@sync_to_async
def get_categories():
    return list(Category.objects.filter(active=True).order_by("name"))


@sync_to_async
def get_products(category_id):
    return [
        p
        for p in Product.objects.filter(
            category_id=category_id,
            available=True,
        ).select_related("category").order_by("name")
        if available(p)
    ]


@sync_to_async
def favorite_ids(user_id, product_ids):
    return set(
        Favorite.objects.filter(
            customer__telegram_user_id=user_id,
            product_id__in=product_ids,
        ).values_list("product_id", flat=True)
    )


async def show_categories(update):
    categories = await get_categories()
    if not categories:
        await update.effective_message.reply_text("📂 अभी कोई category उपलब्ध नहीं है।")
        return

    rows = []
    for i in range(0, len(categories), 2):
        rows.append([
            InlineKeyboardButton(
                f"{category_icon(c.name)} {c.name[:22]}",
                callback_data=f"category_{c.id}",
            )
            for c in categories[i:i + 2]
        ])
    rows.extend([
        [InlineKeyboardButton("🔎 Search Products", callback_data="search_menu")],
        [InlineKeyboardButton("🛒 Cart", callback_data="cart"), InlineKeyboardButton("🏠 Home", callback_data="main_menu")],
    ])

    await update.effective_message.reply_text(
        "🛍 <b>SHOP BY CATEGORY</b>\n\n"
        "अपनी पसंद की category चुनें:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(rows),
    )


async def show_category_products(update, category_id):
    message = update.effective_message
    user = update.effective_user
    products = await get_products(category_id)
    if not products:
        await message.reply_text(
            "😔 इस category में अभी product उपलब्ध नहीं है।",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Categories", callback_data="categories")]]),
        )
        return

    favs = await favorite_ids(user.id, [p.id for p in products])
    category_name = products[0].category.name
    await message.reply_text(
        f"{category_icon(category_name)} <b>{safe(category_name.upper())}</b>\n\n"
        "हर product के नीचे उसका Open button है।\n"
        "दो products के buttons एक row में रखे गए हैं ताकि mobile पर भी आसान रहे।",
        parse_mode="HTML",
    )

    for i in range(0, len(products), 2):
        pair = products[i:i + 2]
        for product in pair:
            star = " ❤️" if product.id in favs else ""
            caption = (
                f"🍬 <b>{safe(product.name)}</b>{star}\n"
                f"💰 {safe(price_text(product))}\n"
                f"{safe(stock_text(product))}\n\n"
                "Tap the product button below to view details."
            )
            try:
                if product.image:
                    await message.reply_photo(
                        photo=product.image.path,
                        caption=caption,
                        parse_mode="HTML",
                    )
                else:
                    await message.reply_text(caption, parse_mode="HTML")
            except Exception:
                logger.exception("Product image failed: %s", product.id)
                await message.reply_text(caption, parse_mode="HTML")

        row = [
            InlineKeyboardButton(
                f"👁 {p.name[:18]}",
                callback_data=f"product_{p.id}",
            )
            for p in pair
        ]
        await message.reply_text(
            "Choose product:",
            reply_markup=InlineKeyboardMarkup([row]),
        )

    await message.reply_text(
        "More options:",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🛒 Cart", callback_data="cart"), InlineKeyboardButton("❤️ Favorites", callback_data="favorites")],
            [InlineKeyboardButton("⬅️ Categories", callback_data="categories"), InlineKeyboardButton("🏠 Home", callback_data="main_menu")],
        ]),
    )


# ============================================================
# PRODUCT DETAIL
# ============================================================


@sync_to_async
def get_product(product_id):
    return Product.objects.filter(id=product_id, available=True).select_related("category").first()


@sync_to_async
def is_fav(user_id, product_id):
    return Favorite.objects.filter(customer__telegram_user_id=user_id, product_id=product_id).exists()


@sync_to_async
def toggle_fav(user_id, product_id):
    customer = Customer.objects.get(telegram_user_id=user_id)
    product = Product.objects.filter(id=product_id).first()
    if not product:
        return "not_found"
    obj = Favorite.objects.filter(customer=customer, product=product).first()
    if obj:
        obj.delete()
        return "removed"
    Favorite.objects.create(customer=customer, product=product)
    return "added"


def detail_keyboard(product, fav, weight, qty):
    rows = []
    if product.is_weight_based:
        buttons = [
            InlineKeyboardButton(
                ("✅ " if weight == g else "") + weight_label(g),
                callback_data=f"weight_{product.id}_{g}",
            )
            for g in weight_options(product)
        ]
        for i in range(0, len(buttons), 2):
            rows.append(buttons[i:i + 2])

    rows.append([
        InlineKeyboardButton("➖", callback_data=f"qtydec_{product.id}"),
        InlineKeyboardButton(f"Qty: {qty}", callback_data="noop"),
        InlineKeyboardButton("➕", callback_data=f"qtyinc_{product.id}"),
    ])
    rows.append([InlineKeyboardButton("🛒 BUY NOW", callback_data=f"buynow_{product.id}")])
    rows.append([
        InlineKeyboardButton("💔 Remove Favorite" if fav else "❤️ Favorite", callback_data=f"favorite_{product.id}"),
        InlineKeyboardButton("🛒 Add to Cart", callback_data=f"addcart_{product.id}"),
    ])
    rows.append([
        InlineKeyboardButton("🛒 Cart", callback_data="cart"),
        InlineKeyboardButton("⬅️ Back", callback_data=f"category_{product.category_id}"),
    ])
    return InlineKeyboardMarkup(rows)


async def render_product(update, product, context):
    user = update.effective_user
    key_qty = f"qty_{product.id}"
    key_weight = f"weight_{product.id}"
    qty = max(int(context.user_data.get(key_qty, 1)), 1)
    weight = int(context.user_data.get(key_weight, weight_options(product)[0])) if product.is_weight_based else 0

    if product.is_weight_based:
        unit_price = price_for_weight(product, weight)
        selection = f"⚖️ Weight: <b>{weight_label(weight)}</b>\n"
    else:
        unit_price = Decimal(product.price)
        selection = ""
    total = unit_price * qty
    fav = await is_fav(user.id, product.id)

    text = (
        f"🍬 <b>{safe(product.name)}</b>\n\n"
        f"{safe(product.description or 'Freshly prepared and carefully packed.')}\n\n"
        f"💰 Price: <b>{money(unit_price)}</b>\n"
        f"{selection}"
        f"🔢 Quantity: <b>{qty}</b>\n"
        f"🧾 Total: <b>{money(total)}</b>\n"
        f"{safe(stock_text(product))}"
    )
    keyboard = detail_keyboard(product, fav, weight, qty)
    try:
        if product.image:
            await update.effective_message.reply_photo(
                photo=product.image.path,
                caption=text,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
        else:
            await update.effective_message.reply_text(text, parse_mode="HTML", reply_markup=keyboard)
    except Exception:
        logger.exception("Product detail image failed: %s", product.id)
        await update.effective_message.reply_text(text, parse_mode="HTML", reply_markup=keyboard)


# ============================================================
# CART
# ============================================================


@sync_to_async
def add_to_cart(user_id, product_id, qty, weight):
    customer = Customer.objects.get(telegram_user_id=user_id)
    product = Product.objects.filter(id=product_id, available=True).first()
    if not product:
        return False, "not_found", 0

    if product.is_weight_based:
        if weight not in weight_options(product):
            return False, "weight", 0
        if qty * weight > product.stock_grams:
            return False, "stock", 0
    elif qty > product.stock:
        return False, "stock", 0

    cart, _ = Cart.objects.get_or_create(customer=customer)
    item, created = CartItem.objects.get_or_create(
        cart=cart,
        product=product,
        defaults={
            "quantity": qty,
            "quantity_grams": weight if product.is_weight_based else 0,
            "price": product.price,
        },
    )
    if not created:
        if product.is_weight_based:
            item.quantity_grams = weight
        new_qty = item.quantity + qty
        if product.is_weight_based and new_qty * item.quantity_grams > product.stock_grams:
            return False, "stock", item.quantity
        if not product.is_weight_based and new_qty > product.stock:
            return False, "stock", item.quantity
        item.quantity = new_qty
        item.price = product.price
        item.save()
    return True, "added", item.quantity


@sync_to_async
def cart_items(user_id):
    customer = Customer.objects.get(telegram_user_id=user_id)
    cart, _ = Cart.objects.get_or_create(customer=customer)
    return list(cart.items.select_related("product").all())


@sync_to_async
def change_cart(user_id, product_id, delta):
    customer = Customer.objects.get(telegram_user_id=user_id)
    item = CartItem.objects.select_related("product").filter(
        cart__customer=customer,
        product_id=product_id,
    ).first()
    if not item:
        return "missing", 0

    new_qty = item.quantity + delta
    if new_qty <= 0:
        item.delete()
        return "removed", 0

    product = item.product
    if product.is_weight_based:
        if new_qty * item.quantity_grams > product.stock_grams:
            return "stock", item.quantity
    elif new_qty > product.stock:
        return "stock", item.quantity

    item.quantity = new_qty
    item.save(update_fields=["quantity"])
    return "updated", new_qty


@sync_to_async
def remove_from_cart(user_id, product_id):
    customer = Customer.objects.get(telegram_user_id=user_id)
    CartItem.objects.filter(cart__customer=customer, product_id=product_id).delete()


@sync_to_async
def empty_cart(user_id):
    customer = Customer.objects.get(telegram_user_id=user_id)
    CartItem.objects.filter(cart__customer=customer).delete()


async def show_cart(update):
    items = await cart_items(update.effective_user.id)
    if not items:
        await update.effective_message.reply_text(
            "🛒 <b>Your Cart is Empty</b>\n\nShop से products add करें।",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]]),
        )
        return

    lines = ["🛒 <b>MY CART</b>", ""]
    rows = []
    total = Decimal("0.00")

    for item in items:
        p = item.product
        if p.is_weight_based and item.quantity_grams:
            unit = price_for_weight(p, item.quantity_grams)
            subtotal = unit * item.quantity
            label = f"{item.quantity} × {weight_label(item.quantity_grams)}"
        else:
            subtotal = item.price * item.quantity
            label = f"{item.quantity} × {money(item.price)}"
        total += subtotal
        lines.append(f"🍬 <b>{safe(p.name)}</b>\n   {label} = <b>{money(subtotal)}</b>")
        rows.append([
            InlineKeyboardButton("➖", callback_data=f"cartdec_{p.id}"),
            InlineKeyboardButton(f"{item.quantity} × {p.name[:12]}", callback_data=f"product_{p.id}"),
            InlineKeyboardButton("➕", callback_data=f"cartinc_{p.id}"),
        ])
        rows.append([InlineKeyboardButton("🗑 Remove", callback_data=f"cartremove_{p.id}")])

    lines.extend(["", f"💰 <b>Subtotal: {money(total)}</b>"])
    rows.extend([
        [InlineKeyboardButton("💳 Checkout", callback_data="checkout")],
        [InlineKeyboardButton("🛍 Continue Shopping", callback_data="categories")],
        [InlineKeyboardButton("🧹 Clear Cart", callback_data="clear_cart")],
    ])
    await update.effective_message.reply_text(
        "\n".join(lines),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(rows),
    )


# ============================================================
# ADDRESS
# ============================================================


@sync_to_async
def addresses(user_id):
    customer = Customer.objects.get(telegram_user_id=user_id)
    return list(CustomerAddress.objects.filter(customer=customer))


@sync_to_async
def default_address(user_id):
    customer = Customer.objects.get(telegram_user_id=user_id)
    return CustomerAddress.objects.filter(customer=customer, is_default=True).first()


@sync_to_async
def save_new_address(user_id, text, city, pincode):
    customer = Customer.objects.get(telegram_user_id=user_id)
    CustomerAddress.objects.filter(customer=customer).update(is_default=False)
    return CustomerAddress.objects.create(
        customer=customer,
        label="home",
        address=text,
        city=city,
        pincode=pincode,
        is_default=True,
    )


@sync_to_async
def make_default_address(user_id, address_id):
    customer = Customer.objects.get(telegram_user_id=user_id)
    address = CustomerAddress.objects.get(id=address_id, customer=customer)
    CustomerAddress.objects.filter(customer=customer).update(is_default=False)
    address.is_default = True
    address.save(update_fields=["is_default"])
    return address


async def show_addresses(update):
    saved = await addresses(update.effective_user.id)
    rows = []
    for address in saved:
        prefix = "✅ " if address.is_default else "📍 "
        rows.append([
            InlineKeyboardButton(
                f"{prefix}{address.city} • {address.pincode}",
                callback_data=f"useaddress_{address.id}",
            )
        ])
    rows.extend([
        [InlineKeyboardButton("➕ Add / Change Address", callback_data="add_address")],
        [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
    ])
    text = "📍 <b>MY DELIVERY ADDRESS</b>\n\n"
    text += "Your saved address:" if saved else "No address saved yet."
    await update.effective_message.reply_text(text, parse_mode="HTML", reply_markup=InlineKeyboardMarkup(rows))


async def start_address_flow(update, context):
    context.user_data["address_mode"] = "contact"
    await update.effective_message.reply_text(
        "📍 <b>DELIVERY ADDRESS</b>\n\n"
        "Step 1 of 2: अपना mobile number share करें।\n\n"
        "फिर मैं आपसे केवल एक आसान address line पूछूँगा।",
        parse_mode="HTML",
        reply_markup=address_contact_keyboard(),
    )


async def handle_contact(update, context):
    contact = update.message.contact
    if not contact or not update.effective_user:
        return
    if contact.user_id and contact.user_id != update.effective_user.id:
        await update.message.reply_text("❌ कृपया अपना ही mobile number share करें।")
        return

    await update_customer_phone(update.effective_user.id, contact.phone_number)
    context.user_data["address_mode"] = "address"
    await update.message.reply_text(
        "✅ Mobile number saved.\n\n"
        "Step 2 of 2:\n"
        "<b>House/Street/Village, City, Pincode</b> लिखें।\n\n"
        "Example: <code>Main Road, Goraul, 844118</code>",
        parse_mode="HTML",
        reply_markup=ReplyKeyboardMarkup([["✖️ Cancel"]], resize_keyboard=True),
    )


async def handle_location(update, context):
    if not update.message.location:
        return
    context.user_data["location_shared"] = True
    context.user_data["address_mode"] = "address"
    await update.message.reply_text(
        "📍 Location received.\n\nअब <b>House/Street/Village, City, Pincode</b> लिखें ताकि delivery team address आसानी से समझ सके।",
        parse_mode="HTML",
        reply_markup=ReplyKeyboardMarkup([["✖️ Cancel"]], resize_keyboard=True),
    )


# ============================================================
# CHECKOUT + ONLINE PAYMENT
# ============================================================


async def show_checkout(update):
    items = await cart_items(update.effective_user.id)
    if not items:
        await update.effective_message.reply_text("🛒 Cart खाली है।")
        return

    address = await default_address(update.effective_user.id)
    if not address:
        await update.effective_message.reply_text(
            "📍 Checkout के लिए delivery address चाहिए।",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📍 Add Address", callback_data="add_address")],
                [InlineKeyboardButton("⬅️ Cart", callback_data="cart")],
            ]),
        )
        return

    total = Decimal("0.00")
    lines = ["💳 <b>CHECKOUT</b>", ""]
    for item in items:
        p = item.product
        if p.is_weight_based and item.quantity_grams:
            subtotal = price_for_weight(p, item.quantity_grams) * item.quantity
            label = f"{item.quantity} × {weight_label(item.quantity_grams)}"
        else:
            subtotal = item.price * item.quantity
            label = str(item.quantity)
        total += subtotal
        lines.append(f"• {safe(p.name)} — {label} = {money(subtotal)}")

    lines += [
        "",
        f"💰 <b>Total: {money(total)}</b>",
        f"📍 <b>Delivery:</b> {safe(address.address)}, {safe(address.city)} - {safe(address.pincode)}",
        "",
        "Payment method चुनें:",
    ]

    await update.effective_message.reply_text(
        "\n".join(lines),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("💵 Cash on Delivery", callback_data=f"cod_{address.id}")],
            [InlineKeyboardButton("💳 Online Payment", callback_data=f"online_{address.id}")],
            [InlineKeyboardButton("📍 Change Address", callback_data="add_address")],
            [InlineKeyboardButton("🛒 Edit Cart", callback_data="cart")],
        ]),
    )


async def create_cod(update, address_id):
    customer = await get_customer(update.effective_user.id)
    try:
        order = await create_order_async(customer.id, address_id, payment_method="cod")
    except Exception as exc:
        logger.exception("COD order failed")
        await update.effective_message.reply_text(f"❌ Order नहीं बन सका: {safe(exc)}")
        return

    await update.effective_message.reply_text(
        f"🎉 <b>ORDER CONFIRMED</b>\n\n"
        f"🆔 <b>{safe(order.order_id)}</b>\n"
        f"💵 Cash on Delivery\n"
        f"💰 <b>{money(order.total_amount)}</b>\n\n"
        "आपको order status के updates Telegram पर मिलेंगे।",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")],
            [InlineKeyboardButton("📦 My Orders", callback_data="orders")],
            [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
        ]),
    )


@sync_to_async
def create_online_payment_for_order(order_id):
    from orders.models import Order
    order = Order.objects.get(order_id=order_id)
    payment, gateway_order = create_razorpay_order(order)
    return payment.gateway_order_id, payment.amount


def payment_url(order_id):
    configured = getattr(settings, "TELEGRAM_WEBHOOK_URL", "").strip()
    if configured:
        parsed = urlsplit(configured)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}/payments/telegram/{order_id}/"

    hostname = getattr(settings, "RENDER_EXTERNAL_HOSTNAME", "").strip()
    if hostname:
        return f"https://{hostname}/payments/telegram/{order_id}/"
    return ""


async def create_online(update, address_id):
    customer = await get_customer(update.effective_user.id)
    try:
        order = await create_order_async(customer.id, address_id, payment_method="online")
        gateway_order_id, amount = await create_online_payment_for_order(order.order_id)
        url = payment_url(order.order_id)
        if not url:
            await update.effective_message.reply_text(
                "❌ Online payment link configuration missing.\n\n"
                "Please use Cash on Delivery or contact support.",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("💵 Use COD", callback_data=f"cod_{address_id}")]]),
            )
            return

        await update.effective_message.reply_text(
            f"💳 <b>ONLINE PAYMENT</b>\n\n"
            f"🆔 Order: <b>{safe(order.order_id)}</b>\n"
            f"💰 Amount: <b>{money(amount)}</b>\n\n"
            "1️⃣ Pay securely\n"
            "2️⃣ Payment verify होगा\n"
            "3️⃣ Successful payment के बाद order automatically Confirmed होगा\n\n"
            "अगर payment fail हो जाए तो यही order retry किया जा सकता है।",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("💳 PAY SECURELY", url=url)],
                [InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")],
                [InlineKeyboardButton("📦 My Orders", callback_data="orders")],
            ]),
        )
    except Exception as exc:
        logger.exception("Online order/payment failed")
        await update.effective_message.reply_text(
            "❌ Online payment शुरू नहीं हो सका।\n\n"
            f"Technical reason: {safe(exc)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("💵 Use COD", callback_data=f"cod_{address_id}")],
                [InlineKeyboardButton("⬅️ Checkout", callback_data="checkout")],
            ]),
        )


# ============================================================
# ORDERS + TRACKING
# ============================================================


async def show_orders(update):
    customer = await get_customer(update.effective_user.id)
    orders = await get_customer_orders(customer.id)
    if not orders:
        await update.effective_message.reply_text(
            "📦 अभी कोई order नहीं है।",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]]),
        )
        return

    await update.effective_message.reply_text("📦 <b>MY ORDERS</b>", parse_mode="HTML")
    for order in orders[:10]:
        await update.effective_message.reply_text(
            f"🆔 <b>{safe(order.order_id)}</b>\n"
            f"📌 {safe(order.get_order_status_display())}\n"
            f"💳 {safe(order.get_payment_status_display())}\n"
            f"💰 {money(order.total_amount)}\n"
            f"🗓 {order.created_at:%d-%m-%Y %H:%M}",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📋 Details", callback_data=f"order_{order.order_id}"), InlineKeyboardButton("📍 Track", callback_data=f"track_{order.order_id}")],
            ]),
        )


async def show_order_details(update, order_id):
    customer = await get_customer(update.effective_user.id)
    details = await get_order_details(customer.id, order_id)
    if not details:
        await update.effective_message.reply_text("❌ Order नहीं मिला।")
        return

    order, items = details["order"], details["items"]
    lines = [
        f"📦 <b>ORDER #{safe(order.order_id)}</b>",
        "",
        f"📌 Status: <b>{safe(order.get_order_status_display())}</b>",
        f"💳 Payment: {safe(order.get_payment_status_display())}",
        f"📍 {safe(order.address)}",
        "",
        "🛍 <b>Items:</b>",
    ]
    for item in items:
        if item.quantity_grams:
            lines.append(f"• {safe(item.product_name)} × {item.quantity} × {weight_label(item.quantity_grams)} = {money(item.subtotal)}")
        else:
            lines.append(f"• {safe(item.product_name)} × {item.quantity} = {money(item.subtotal)}")
    lines.append(f"\n💰 <b>Total: {money(order.total_amount)}</b>")

    buttons = [
        [InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")],
        [InlineKeyboardButton("🔁 Reorder", callback_data=f"reorder_{order.order_id}")],
        [InlineKeyboardButton("⬅️ My Orders", callback_data="orders")],
    ]
    if order.payment_method == "online" and order.payment_status != "paid":
        url = payment_url(order.order_id)
        if url:
            buttons.insert(0, [InlineKeyboardButton("💳 Retry Online Payment", url=url)])

    await update.effective_message.reply_text(
        "\n".join(lines),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def show_tracking(update, order_id):
    customer = await get_customer(update.effective_user.id)
    details = await get_order_details(customer.id, order_id)
    if not details:
        await update.effective_message.reply_text("❌ Order नहीं मिला।")
        return

    order = details["order"]
    tracking = await build_order_tracking(order)
    lines = [
        f"📦 <b>ORDER TRACKING</b>",
        f"🆔 {safe(order_id)}",
        "",
    ]
    lines.extend(safe(label) for _, label in tracking["steps"])
    lines.extend([
        "",
        f"Current status: <b>{safe(order.get_order_status_display())}</b>",
    ])

    await update.effective_message.reply_text(
        "\n".join(lines),
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔄 Refresh Status", callback_data=f"track_{order_id}")],
            [InlineKeyboardButton("📦 My Orders", callback_data="orders")],
            [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
        ]),
    )


# ============================================================
# SEARCH + FAVORITES
# ============================================================


@sync_to_async
def search_products(text):
    qs = Product.objects.filter(available=True).select_related("category").order_by("name")
    if text:
        qs = qs.filter(name__icontains=text)
    return list(qs[:12])


async def search_menu(update, context):
    context.user_data["search_mode"] = True
    suggestions = await search_products("")
    rows = [[InlineKeyboardButton(f"🔎 {p.name[:30]}", callback_data=f"searchpick_{p.id}")] for p in suggestions[:8]]
    rows.append([InlineKeyboardButton("⬅️ Back", callback_data="main_menu")])
    await update.effective_message.reply_text(
        "🔎 <b>SEARCH PRODUCTS</b>\n\n"
        "Product name type करें या suggestion चुनें:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(rows),
    )
    await update.effective_message.reply_text("⌨️ अब product name लिखें:")


async def search_results(update, text):
    products = await search_products(text)
    if not products:
        await update.effective_message.reply_text(
            "😔 कोई product नहीं मिला।",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔎 Search Again", callback_data="search_menu")],
                [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
            ]),
        )
        return

    await update.effective_message.reply_text(f"🔎 <b>Results: {safe(text)}</b>", parse_mode="HTML")
    for p in products:
        caption = f"🍬 <b>{safe(p.name)}</b>\n💰 {safe(price_text(p))}\n{safe(stock_text(p))}"
        if p.image:
            try:
                await update.effective_message.reply_photo(photo=p.image.path, caption=caption, parse_mode="HTML")
            except Exception:
                await update.effective_message.reply_text(caption, parse_mode="HTML")
        else:
            await update.effective_message.reply_text(caption, parse_mode="HTML")
        await update.effective_message.reply_text(
            "Choose:",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("👁 Open Product", callback_data=f"product_{p.id}")]]),
        )


@sync_to_async
def get_favorite_products(user_id):
    return list(Favorite.objects.filter(customer__telegram_user_id=user_id).select_related("product"))


async def show_favorites(update):
    favorites = await get_favorite_products(update.effective_user.id)
    products = [f.product for f in favorites if f.product.available and available(f.product)]
    if not products:
        await update.effective_message.reply_text(
            "❤️ Favorites खाली हैं।",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]]),
        )
        return

    await update.effective_message.reply_text("❤️ <b>MY FAVORITES</b>", parse_mode="HTML")
    for p in products:
        caption = f"🍬 <b>{safe(p.name)}</b>\n💰 {safe(price_text(p))}\n{safe(stock_text(p))}"
        if p.image:
            try:
                await update.effective_message.reply_photo(photo=p.image.path, caption=caption, parse_mode="HTML")
            except Exception:
                await update.effective_message.reply_text(caption, parse_mode="HTML")
        else:
            await update.effective_message.reply_text(caption, parse_mode="HTML")
        await update.effective_message.reply_text(
            "Choose:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("👁 Open Product", callback_data=f"product_{p.id}")],
                [InlineKeyboardButton("💔 Remove Favorite", callback_data=f"favorite_{p.id}")],
            ]),
        )


# ============================================================
# CALLBACK HANDLER
# ============================================================


async def callback_handler(update, context):
    query = update.callback_query
    await query.answer()
    data = query.data or ""
    user = update.effective_user

    try:
        if data == "language_hi":
            customer = await set_language(user.id, "hi")
            await query.edit_message_text("🇮🇳 हिंदी selected.")
            await send_menu(update, customer)
            return

        if data == "language_en":
            customer = await set_language(user.id, "en")
            await query.edit_message_text("🇬🇧 English selected.")
            await send_menu(update, customer)
            return

        if data == "main_menu":
            customer = await get_customer(user.id)
            await send_menu(update, customer)
            return

        if data == "categories":
            await show_categories(update)
            return
        if data.startswith("category_"):
            await show_category_products(update, int(data.split("_", 1)[1]))
            return
        if data == "favorites":
            await show_favorites(update)
            return
        if data == "cart":
            await show_cart(update)
            return
        if data == "clear_cart":
            await empty_cart(user.id)
            await query.message.reply_text("🧹 Cart cleared.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Shop", callback_data="categories")]]))
            return

        if data == "search_menu":
            await search_menu(update, context)
            return
        if data.startswith("searchpick_") or data.startswith("product_"):
            pid = int(data.split("_", 1)[1])
            product = await get_product(pid)
            if product:
                context.user_data[f"qty_{pid}"] = 1
                if product.is_weight_based:
                    context.user_data[f"weight_{pid}"] = weight_options(product)[0]
                await render_product(update, product, context)
            return

        if data.startswith("weight_"):
            _, pid, grams = data.split("_")
            pid, grams = int(pid), int(grams)
            product = await get_product(pid)
            if product and grams in weight_options(product):
                context.user_data[f"weight_{pid}"] = grams
                context.user_data[f"qty_{pid}"] = 1
                await render_product(update, product, context)
            return

        if data.startswith("qtyinc_") or data.startswith("qtydec_"):
            pid = int(data.split("_", 1)[1])
            product = await get_product(pid)
            if product:
                key = f"qty_{pid}"
                qty = max(int(context.user_data.get(key, 1)), 1)
                context.user_data[key] = qty + 1 if data.startswith("qtyinc_") else max(1, qty - 1)
                await render_product(update, product, context)
            return

        if data.startswith("favorite_"):
            result = await toggle_fav(user.id, int(data.split("_", 1)[1]))
            await query.message.reply_text(
                "❤️ Favorites में add हो गया।" if result == "added" else
                "💔 Favorites से remove हो गया।" if result == "removed" else
                "❌ Product नहीं मिला."
            )
            return

        if data.startswith("addcart_") or data.startswith("buynow_"):
            pid = int(data.split("_", 1)[1])
            product = await get_product(pid)
            if not product:
                await query.message.reply_text("❌ Product नहीं मिला।")
                return
            qty = int(context.user_data.get(f"qty_{pid}", 1))
            grams = int(context.user_data.get(f"weight_{pid}", 0)) if product.is_weight_based else 0
            ok, reason, current = await add_to_cart(user.id, pid, qty, grams)
            if not ok:
                message = {
                    "stock": "⚠️ Selected quantity stock से अधिक है।",
                    "weight": "⚖️ पहले weight चुनें।",
                    "not_found": "❌ Product नहीं मिला।",
                }.get(reason, "❌ Product add नहीं हुआ।")
                await query.message.reply_text(message)
                return
            await query.message.reply_text(
                f"✅ <b>{safe(product.name)}</b> Cart में add हो गया।\n\nQuantity: {current}",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🛒 View Cart", callback_data="cart"), InlineKeyboardButton("🛍 Continue", callback_data=f"category_{product.category_id}")]
                ]),
            )
            if data.startswith("buynow_"):
                await show_cart(update)
            return

        if data.startswith("cartinc_") or data.startswith("cartdec_"):
            pid = int(data.split("_", 1)[1])
            result, qty = await change_cart(user.id, pid, 1 if data.startswith("cartinc_") else -1)
            if result == "stock":
                await query.message.reply_text(f"⚠️ Maximum available quantity: {qty}")
            elif result == "removed":
                await query.message.reply_text("🗑 Product removed from Cart.")
            await show_cart(update)
            return

        if data.startswith("cartremove_"):
            await remove_from_cart(user.id, int(data.split("_", 1)[1]))
            await show_cart(update)
            return

        if data == "checkout":
            await show_checkout(update)
            return
        if data.startswith("cod_"):
            await create_cod(update, int(data.split("_", 1)[1]))
            return
        if data.startswith("online_"):
            await create_online(update, int(data.split("_", 1)[1]))
            return

        if data == "orders":
            await show_orders(update)
            return
        if data.startswith("order_"):
            await show_order_details(update, data.split("_", 1)[1])
            return
        if data.startswith("track_"):
            await show_tracking(update, data.split("_", 1)[1])
            return
        if data.startswith("reorder_"):
            customer = await get_customer(user.id)
            try:
                result = await sync_to_async(reorder_order)(customer.id, data.split("_", 1)[1])
                lines = ["🔁 <b>REORDER</b>", ""]
                if result["added"]:
                    lines.append("✅ Added:")
                    lines.extend(f"• {safe(x)}" for x in result["added"])
                if result["skipped"]:
                    lines.extend(["", "⚠️ Skipped:"])
                    lines.extend(f"• {safe(x)}" for x in result["skipped"])
                await query.message.reply_text(
                    "\n".join(lines),
                    parse_mode="HTML",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛒 View Cart", callback_data="cart")]]),
                )
            except Exception as exc:
                await query.message.reply_text(f"❌ Reorder नहीं हो सका: {safe(exc)}")
            return

        if data == "address":
            await show_addresses(update)
            return
        if data == "add_address":
            await start_address_flow(update, context)
            return
        if data.startswith("useaddress_"):
            address = await make_default_address(user.id, int(data.split("_", 1)[1]))
            await query.message.reply_text(
                f"✅ <b>{safe(address.city)}</b> address default set हो गया।",
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("💳 Checkout", callback_data="checkout")]]),
            )
            return

        if data == "noop":
            return

        await query.message.reply_text("❌ Unknown option. /start चलाएँ।")
    except Exception:
        logger.exception("CALLBACK HANDLER FAILED: %s", data)
        await query.message.reply_text("❌ Button process करते समय error आया। Please try again.")


# ============================================================
# TEXT / CONTACT / LOCATION
# ============================================================


async def text_handler(update, context):
    if not update.message or not update.effective_user:
        return

    text = (update.message.text or "").strip()
    if text == "✖️ Cancel":
        context.user_data.pop("address_mode", None)
        context.user_data.pop("search_mode", None)
        await update.message.reply_text("❌ Cancelled.", reply_markup=ReplyKeyboardRemove())
        customer = await get_customer(update.effective_user.id)
        await send_menu(update, customer)
        return

    address_mode = context.user_data.get("address_mode")
    if address_mode == "contact":
        digits = "".join(ch for ch in text if ch.isdigit())
        if len(digits) >= 10:
            await update_customer_phone(update.effective_user.id, digits[-10:])
            context.user_data["address_mode"] = "address"
            await update.message.reply_text(
                "✅ Mobile number saved.\n\n"
                "अब <b>House/Street/Village, City, Pincode</b> लिखें।\n"
                "Example: <code>Main Road, Goraul, 844118</code>",
                parse_mode="HTML",
                reply_markup=ReplyKeyboardMarkup([["✖️ Cancel"]], resize_keyboard=True),
            )
        else:
            await update.message.reply_text("📱 कृपया 10-digit mobile number भेजें या Share Mobile Number दबाएँ।")
        return

    if address_mode == "address":
        parts = [part.strip() for part in text.split(",") if part.strip()]
        pincode = parts[-1] if parts else ""
        if not pincode.isdigit() or len(pincode) != 6 or len(parts) < 3:
            await update.message.reply_text(
                "❌ Address format सही नहीं है।\n\n"
                "इस तरह भेजें:\n<code>House/Street/Village, City, Pincode</code>\n\n"
                "Example: <code>Main Road, Goraul, 844118</code>",
                parse_mode="HTML",
            )
            return
        city = parts[-2]
        address_text = ", ".join(parts[:-2])
        address = await save_new_address(update.effective_user.id, address_text, city, pincode)
        context.user_data.pop("address_mode", None)
        await update.message.reply_text(
            f"✅ <b>Address Saved</b>\n\n"
            f"📍 {safe(address.address)}, {safe(address.city)} - {safe(address.pincode)}",
            parse_mode="HTML",
            reply_markup=ReplyKeyboardRemove(),
        )
        await update.message.reply_text(
            "अब checkout के लिए ready हैं:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("💳 Checkout", callback_data="checkout")],
                [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
            ]),
        )
        return

    if context.user_data.get("search_mode"):
        context.user_data["search_mode"] = False
        await search_results(update, text)
        return

    if text in ["🛍 दुकान देखें", "🛍 Shop"]:
        await show_categories(update)
        return
    if text == "🔎 Search":
        await search_menu(update, context)
        return
    if text in ["🛒 मेरी Cart", "🛒 My Cart"]:
        await show_cart(update)
        return
    if text == "❤️ Favorites":
        await show_favorites(update)
        return
    if text in ["📦 मेरे Orders", "📦 My Orders"]:
        await show_orders(update)
        return
    if text in ["📍 मेरा Address", "📍 My Address"]:
        await show_addresses(update)
        return
    if text == "🌐 Language":
        await update.message.reply_text("🌐 भाषा चुनें:", reply_markup=language_keyboard())
        return
    if text == "☎️ Help":
        await update.message.reply_text(
            "☎️ <b>HELP</b>\n\n"
            "🛍 Shop — products browse करें\n"
            "🔎 Search — product खोजें\n"
            "🛒 Cart — quantity और checkout\n"
            "❤️ Favorites — पसंदीदा products\n"
            "📦 Orders — order history\n"
            "📍 Track — live order status\n"
            "📍 Address — saved delivery address",
            parse_mode="HTML",
        )
        return

    await update.message.reply_text("कृपया menu से option चुनें या /start चलाएँ।")


# ============================================================
# ERROR + HANDLERS
# ============================================================


async def telegram_error_handler(update, context):
    logger.error("Telegram update error", exc_info=context.error)


def register_handlers(application):
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(callback_handler))
    application.add_handler(MessageHandler(filters.CONTACT, handle_contact))
    application.add_handler(MessageHandler(filters.LOCATION, handle_location))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
    application.add_error_handler(telegram_error_handler)
