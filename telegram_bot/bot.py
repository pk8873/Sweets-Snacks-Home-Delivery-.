import logging
from decimal import Decimal, ROUND_HALF_UP

from asgiref.sync import sync_to_async
from django.conf import settings

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

from cart.models import Cart, CartItem
from customers.models import Customer, CustomerAddress
from products.models import Category, Favorite, Product
from orders.services import build_order_tracking, create_order_async, get_customer_orders, get_order_details

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
    return f"{money(price_for_weight(product, 250))} / 250 g" if product.is_weight_based else money(product.price)


def stock_text(product):
    return f"📦 {weight_label(product.stock_grams)} available" if product.is_weight_based else f"📦 {product.stock} available"


# ============================================================
# CUSTOMER / MENU
# ============================================================


@sync_to_async
def get_or_create_customer(user):
    customer, _ = Customer.objects.get_or_create(
        telegram_user_id=user.id,
        defaults={"telegram_username": user.username or "", "name": user.full_name or "Customer"},
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


def language_keyboard():
    return InlineKeyboardMarkup([[InlineKeyboardButton("🇮🇳 हिंदी", callback_data="language_hi"), InlineKeyboardButton("🇬🇧 English", callback_data="language_en")]])


def hindi_menu():
    return ReplyKeyboardMarkup(
        [["🛍 दुकान देखें", "🔎 Search"], ["🛒 मेरी Cart", "❤️ Favorites"], ["📦 मेरे Orders", "📍 मेरा Address"], ["🌐 Language", "☎️ Help"]],
        resize_keyboard=True,
        is_persistent=True,
    )


def english_menu():
    return ReplyKeyboardMarkup(
        [["🛍 Shop", "🔎 Search"], ["🛒 My Cart", "❤️ Favorites"], ["📦 My Orders", "📍 My Address"], ["🌐 Language", "☎️ Help"]],
        resize_keyboard=True,
        is_persistent=True,
    )


async def send_menu(update, customer):
    if customer.language == "en":
        await update.effective_message.reply_text(
            f"🍬 *Welcome, {customer.name}!*\n\nFresh sweets & snacks delivered to your door.",
            parse_mode="Markdown",
            reply_markup=english_menu(),
        )
    else:
        await update.effective_message.reply_text(
            f"🍬 *{customer.name} जी, Sweet & Snacks में आपका स्वागत है!*\n\nताज़ी मिठाई और snacks घर तक मंगाइए।",
            parse_mode="Markdown",
            reply_markup=hindi_menu(),
        )


async def start(update, context):
    try:
        user = update.effective_user
        if not user:
            return
        context.user_data.clear()
        customer = await get_or_create_customer(user)
        if not customer.language:
            await update.effective_message.reply_text(
                "🍬 *Sweet & Snacks*\n\nWelcome / स्वागत है!\nअपनी भाषा चुनें:",
                parse_mode="Markdown",
                reply_markup=language_keyboard(),
            )
        else:
            await send_menu(update, customer)
    except Exception:
        logger.exception("START handler failed")
        await update.effective_message.reply_text("❌ कुछ गलत हुआ। कृपया /start फिर से भेजें।")


# ============================================================
# CATEGORIES + TWO-COLUMN PRODUCT SELECTOR
# ============================================================


@sync_to_async
def get_categories():
    return list(Category.objects.filter(active=True).order_by("name"))


@sync_to_async
def get_products(category_id):
    return [p for p in Product.objects.filter(category_id=category_id, available=True).select_related("category").order_by("name") if available(p)]


@sync_to_async
def favorite_ids(user_id, product_ids):
    return set(Favorite.objects.filter(customer__telegram_user_id=user_id, product_id__in=product_ids).values_list("product_id", flat=True))


async def show_categories(update):
    categories = await get_categories()
    if not categories:
        await update.effective_message.reply_text("📂 अभी कोई category उपलब्ध नहीं है।")
        return
    rows = []
    for i in range(0, len(categories), 2):
        rows.append([
            InlineKeyboardButton(f"📂 {c.name}", callback_data=f"category_{c.id}")
            for c in categories[i:i + 2]
        ])
    rows.append([InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")])
    await update.effective_message.reply_text(
        "🛍 *Shop by Category*\n\nCategory चुनें:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(rows),
    )


async def show_category_products(update, category_id):
    message = update.effective_message
    user = update.effective_user
    products = await get_products(category_id)
    if not products:
        await message.reply_text("😔 इस category में अभी product उपलब्ध नहीं है।", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Categories", callback_data="categories")]]))
        return

    favs = await favorite_ids(user.id, [p.id for p in products])
    await message.reply_text(
        f"🛍 *{products[0].category.name}*\n\nहर row में 2 products browse करें। Product खोलकर quantity और purchase options चुनें।",
        parse_mode="Markdown",
    )

    for i in range(0, len(products), 2):
        pair = products[i:i + 2]
        for product in pair:
            caption = f"🍬 *{product.name}*\n💰 {price_text(product)}\n{stock_text(product)}"
            try:
                if product.image:
                    await message.reply_photo(photo=product.image.path, caption=caption, parse_mode="Markdown")
                else:
                    await message.reply_text(caption, parse_mode="Markdown")
            except Exception:
                logger.exception("Product image failed: %s", product.id)
                await message.reply_text(caption, parse_mode="Markdown")

        row = [
            InlineKeyboardButton(f"🛍 {p.name[:13]}", callback_data=f"product_{p.id}")
            for p in pair
        ]
        await message.reply_text(
            "Choose product:",
            reply_markup=InlineKeyboardMarkup([
                row,
                [InlineKeyboardButton("❤️ Favorites", callback_data="favorites"), InlineKeyboardButton("⬅️ Back", callback_data="categories")],
            ]),
        )


# ============================================================
# PRODUCT DETAIL + WEIGHT + +/-
# ============================================================


@sync_to_async
def get_product(product_id):
    return Product.objects.filter(id=product_id, available=True).first()


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
        buttons = [InlineKeyboardButton(("✅ " if weight == g else "") + weight_label(g), callback_data=f"weight_{product.id}_{g}") for g in weight_options(product)]
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
    rows.append([InlineKeyboardButton("⬅️ Back", callback_data=f"category_{product.category_id}")])
    return InlineKeyboardMarkup(rows)


async def render_product(update, product, context):
    user = update.effective_user
    key_qty = f"qty_{product.id}"
    key_weight = f"weight_{product.id}"
    qty = max(int(context.user_data.get(key_qty, 1)), 1)
    weight = int(context.user_data.get(key_weight, weight_options(product)[0])) if product.is_weight_based else 0
    if product.is_weight_based:
        unit_price = price_for_weight(product, weight)
        total = unit_price * qty
        selection = f"⚖️ Weight: *{weight_label(weight)}*\n"
    else:
        unit_price = Decimal(product.price)
        total = unit_price * qty
        selection = ""
    fav = await is_fav(user.id, product.id)
    text = (
        f"🍬 *{product.name}*\n\n"
        f"{product.description or 'Freshly prepared and carefully packed.'}\n\n"
        f"💰 Price: *{money(unit_price)}*\n"
        f"{selection}"
        f"🔢 Quantity: *{qty}*\n"
        f"🧾 Total: *{money(total)}*\n"
        f"{stock_text(product)}"
    )
    keyboard = detail_keyboard(product, fav, weight, qty)
    try:
        if product.image:
            await update.effective_message.reply_photo(photo=product.image.path, caption=text, parse_mode="Markdown", reply_markup=keyboard)
        else:
            await update.effective_message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception:
        await update.effective_message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)


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
        defaults={"quantity": qty, "quantity_grams": weight if product.is_weight_based else 0, "price": product.price},
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
    item = CartItem.objects.select_related("product").filter(cart__customer=customer, product_id=product_id).first()
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
    item.save()
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
        await update.effective_message.reply_text("🛒 *Cart खाली है*", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]]))
        return
    lines = ["🛒 *My Cart*", ""]
    rows = []
    total = Decimal("0.00")
    for item in items:
        p = item.product
        if p.is_weight_based and item.quantity_grams:
            unit = price_for_weight(p, item.quantity_grams)
            subtotal = unit * item.quantity
            lines.append(f"🍬 {p.name}\n   {item.quantity} × {weight_label(item.quantity_grams)} = *{money(subtotal)}*")
        else:
            subtotal = item.price * item.quantity
            lines.append(f"🍬 {p.name}\n   {item.quantity} × {money(item.price)} = *{money(subtotal)}*")
        total += subtotal
        rows.append([InlineKeyboardButton("➖", callback_data=f"cartdec_{p.id}"), InlineKeyboardButton(f"{item.quantity} × {p.name[:10]}", callback_data=f"product_{p.id}"), InlineKeyboardButton("➕", callback_data=f"cartinc_{p.id}")])
        rows.append([InlineKeyboardButton("🗑 Remove", callback_data=f"cartremove_{p.id}")])
    lines.append(f"\n💰 *Subtotal: {money(total)}*")
    rows.extend([
        [InlineKeyboardButton("💳 Checkout", callback_data="checkout")],
        [InlineKeyboardButton("🛍 Continue Shopping", callback_data="categories")],
        [InlineKeyboardButton("🧹 Clear Cart", callback_data="clear_cart")],
    ])
    await update.effective_message.reply_text("\n".join(lines), parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(rows))


# ============================================================
# ADDRESS + CHECKOUT
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
    return CustomerAddress.objects.create(customer=customer, label="home", address=text, city=city, pincode=pincode, is_default=True)


@sync_to_async
def make_default_address(user_id, address_id):
    customer = Customer.objects.get(telegram_user_id=user_id)
    address = CustomerAddress.objects.get(id=address_id, customer=customer)
    CustomerAddress.objects.filter(customer=customer).update(is_default=False)
    address.is_default = True
    address.save(update_fields=["is_default"])
    return address


async def show_addresses(update):
    rows = []
    for address in await addresses(update.effective_user.id):
        prefix = "✅ " if address.is_default else "📍 "
        rows.append([InlineKeyboardButton(f"{prefix}{address.city} - {address.pincode}", callback_data=f"useaddress_{address.id}")])
    rows += [[InlineKeyboardButton("➕ Add New Address", callback_data="add_address")], [InlineKeyboardButton("⬅️ Main Menu", callback_data="main_menu")]]
    await update.effective_message.reply_text("📍 *Delivery Address*", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(rows))


async def show_checkout(update):
    items = await cart_items(update.effective_user.id)
    if not items:
        await update.effective_message.reply_text("🛒 Cart खाली है।")
        return
    address = await default_address(update.effective_user.id)
    if not address:
        await update.effective_message.reply_text("📍 Checkout के लिए delivery address चाहिए।", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("➕ Add Address", callback_data="add_address")], [InlineKeyboardButton("⬅️ Cart", callback_data="cart")]]))
        return
    total = Decimal("0.00")
    lines = ["💳 *Checkout*", ""]
    for item in items:
        p = item.product
        if p.is_weight_based and item.quantity_grams:
            subtotal = price_for_weight(p, item.quantity_grams) * item.quantity
            label = f"{item.quantity} × {weight_label(item.quantity_grams)}"
        else:
            subtotal = item.price * item.quantity
            label = str(item.quantity)
        total += subtotal
        lines.append(f"• {p.name} — {label} = {money(subtotal)}")
    lines += ["", f"💰 *Total: {money(total)}*", f"📍 {address.address}, {address.city} - {address.pincode}", "", "Payment method चुनें:"]
    await update.effective_message.reply_text("\n".join(lines), parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([
        [InlineKeyboardButton("💵 Cash on Delivery", callback_data=f"cod_{address.id}")],
        [InlineKeyboardButton("💳 Online Payment", callback_data=f"online_{address.id}")],
        [InlineKeyboardButton("🛒 Edit Cart", callback_data="cart")],
        [InlineKeyboardButton("❌ Cancel", callback_data="categories")],
    ]))


async def create_cod(update, address_id):
    customer = await get_customer(update.effective_user.id)
    try:
        order = await create_order_async(customer.id, address_id, payment_method="cod")
    except Exception as exc:
        logger.exception("COD order failed")
        await update.effective_message.reply_text(f"❌ Order नहीं बन सका: {exc}")
        return
    await update.effective_message.reply_text(
        f"🎉 *Order Confirmed!*\n\n🆔 *{order.order_id}*\n💵 Cash on Delivery\n💰 *{money(order.total_amount)}*",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")], [InlineKeyboardButton("📦 My Orders", callback_data="orders")], [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")]]),
    )


# ============================================================
# ORDERS / TRACKING — STATUS FLOW UNCHANGED
# ============================================================


async def show_orders(update):
    customer = await get_customer(update.effective_user.id)
    orders = await get_customer_orders(customer.id)
    if not orders:
        await update.effective_message.reply_text("📦 अभी कोई order नहीं है।", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]]))
        return
    await update.effective_message.reply_text("📦 *My Orders*", parse_mode="Markdown")
    for order in orders[:10]:
        await update.effective_message.reply_text(
            f"🆔 *{order.order_id}*\n📌 {order.get_order_status_display()}\n💰 {money(order.total_amount)}\n🗓 {order.created_at:%d-%m-%Y %H:%M}",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("📋 Details", callback_data=f"order_{order.order_id}")], [InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")]]),
        )


async def show_order_details(update, order_id):
    customer = await get_customer(update.effective_user.id)
    details = await get_order_details(customer.id, order_id)
    if not details:
        await update.effective_message.reply_text("❌ Order नहीं मिला।")
        return
    order, items = details["order"], details["items"]
    lines = [f"📦 *Order #{order.order_id}*", "", f"📌 {order.get_order_status_display()}", f"💳 {order.get_payment_method_display()}", f"📍 {order.address}", "", "🛍 *Items:"]
    for item in items:
        if item.quantity_grams:
            lines.append(f"• {item.product_name} × {item.quantity} × {weight_label(item.quantity_grams)} = {money(item.subtotal)}")
        else:
            lines.append(f"• {item.product_name} × {item.quantity} = {money(item.subtotal)}")
    lines.append(f"\n💰 *Total: {money(order.total_amount)}*")
    await update.effective_message.reply_text("\n".join(lines), parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")], [InlineKeyboardButton("⬅️ My Orders", callback_data="orders")]]))


async def show_tracking(update, order_id):
    customer = await get_customer(update.effective_user.id)
    details = await get_order_details(customer.id, order_id)
    if not details:
        await update.effective_message.reply_text("❌ Order नहीं मिला।")
        return
    tracking = await build_order_tracking(details["order"])
    lines = [f"📦 *Order Tracking*\n\n🆔 {order_id}", ""] + [label for _, label in tracking["steps"]]
    await update.effective_message.reply_text("\n".join(lines), parse_mode="Markdown", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ My Orders", callback_data="orders")], [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")]]))


# ============================================================
# SEARCH
# ============================================================


@sync_to_async
def search_products(text):
    return list(Product.objects.filter(available=True, name__icontains=text).order_by("name")[:12])


async def search_menu(update, context):
    context.user_data["search_mode"] = True
    suggestions = await search_products("")
    rows = [[InlineKeyboardButton(f"🔎 {p.name[:32]}", callback_data=f"searchpick_{p.id}")] for p in suggestions[:8]]
    rows.append([InlineKeyboardButton("⬅️ Back", callback_data="main_menu")])
    await update.effective_message.reply_text("🔎 *Search*\n\nProduct name type करें या suggestion चुनें:", parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(rows))
    await update.effective_message.reply_text("⌨️ अब product name लिखें:")


async def search_results(update, text):
    products = await search_products(text)
    if not products:
        await update.effective_message.reply_text("😔 कोई product नहीं मिला।", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔎 Search Again", callback_data="search_menu")], [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")]]))
        return
    await update.effective_message.reply_text(f"🔎 *Results: {text}*", parse_mode="Markdown")
    for p in products:
        caption = f"🍬 *{p.name}*\n💰 {price_text(p)}\n{stock_text(p)}"
        if p.image:
            try:
                await update.effective_message.reply_photo(photo=p.image.path, caption=caption, parse_mode="Markdown")
            except Exception:
                await update.effective_message.reply_text(caption, parse_mode="Markdown")
        else:
            await update.effective_message.reply_text(caption, parse_mode="Markdown")
        await update.effective_message.reply_text("Choose:", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Open Product", callback_data=f"product_{p.id}")]]))


# ============================================================
# CALLBACK + TEXT
# ============================================================


async def callback_handler(update, context):
    q = update.callback_query
    await q.answer()
    data = q.data or ""
    user = update.effective_user
    try:
        if data == "language_hi":
            customer = await set_language(user.id, "hi")
            await q.edit_message_text("🇮🇳 हिंदी selected.")
            await send_menu(update, customer); return
        if data == "language_en":
            customer = await set_language(user.id, "en")
            await q.edit_message_text("🇬🇧 English selected.")
            await send_menu(update, customer); return
        if data == "main_menu":
            customer = await get_customer(user.id)
            await send_menu(update, customer); return
        if data == "categories": await show_categories(update); return
        if data.startswith("category_"): await show_category_products(update, int(data.split("_", 1)[1])); return
        if data == "favorites": await show_favorites(update); return
        if data == "cart": await show_cart(update); return
        if data == "clear_cart": await empty_cart(user.id); await q.message.reply_text("🧹 Cart cleared."); return
        if data == "search_menu": await search_menu(update, context); return
        if data.startswith("searchpick_"):
            pid = int(data.split("_", 1)[1]); p = await get_product(pid)
            if p:
                context.user_data[f"qty_{pid}"] = 1
                if p.is_weight_based: context.user_data[f"weight_{pid}"] = weight_options(p)[0]
                await render_product(update, p, context)
            return
        if data.startswith("product_"):
            pid = int(data.split("_", 1)[1]); p = await get_product(pid)
            if p:
                context.user_data[f"qty_{pid}"] = 1
                if p.is_weight_based: context.user_data[f"weight_{pid}"] = weight_options(p)[0]
                await render_product(update, p, context)
            return
        if data.startswith("weight_"):
            _, pid, grams = data.split("_"); pid, grams = int(pid), int(grams)
            context.user_data[f"weight_{pid}"] = grams; context.user_data[f"qty_{pid}"] = 1
            p = await get_product(pid)
            if p: await render_product(update, p, context)
            return
        if data.startswith("qtyinc_") or data.startswith("qtydec_"):
            pid = int(data.split("_", 1)[1]); p = await get_product(pid)
            if p:
                key = f"qty_{pid}"; qty = int(context.user_data.get(key, 1))
                qty = qty + 1 if data.startswith("qtyinc_") else max(1, qty - 1)
                context.user_data[key] = qty; await render_product(update, p, context)
            return
        if data.startswith("favorite_"):
            result = await toggle_fav(user.id, int(data.split("_", 1)[1]))
            await q.message.reply_text("❤️ Favorites में add हो गया।" if result == "added" else "💔 Favorites से remove हो गया।" if result == "removed" else "❌ Product नहीं मिला।")
            return
        if data.startswith("addcart_") or data.startswith("buynow_"):
            pid = int(data.split("_", 1)[1]); p = await get_product(pid)
            if not p: await q.message.reply_text("❌ Product नहीं मिला।"); return
            qty = int(context.user_data.get(f"qty_{pid}", 1)); grams = int(context.user_data.get(f"weight_{pid}", 0)) if p.is_weight_based else 0
            ok, reason, current = await add_to_cart(user.id, pid, qty, grams)
            if not ok:
                await q.message.reply_text("⚠️ Selected quantity stock से अधिक है।" if reason == "stock" else "⚖️ पहले weight चुनें।" if reason == "weight" else "❌ Product नहीं मिला।"); return
            await q.message.reply_text(f"✅ {p.name} Cart में add हो गया।")
            if data.startswith("buynow_"): await show_checkout(update)
            return
        if data.startswith("cartinc_") or data.startswith("cartdec_"):
            pid = int(data.split("_", 1)[1]); result, qty = await change_cart(user.id, pid, 1 if data.startswith("cartinc_") else -1)
            if result == "stock": await q.message.reply_text(f"⚠️ Maximum available quantity: {qty}")
            elif result == "removed": await q.message.reply_text("🗑 Product removed from Cart.")
            await show_cart(update); return
        if data.startswith("cartremove_"):
            await remove_from_cart(user.id, int(data.split("_", 1)[1])); await show_cart(update); return
        if data == "checkout": await show_checkout(update); return
        if data.startswith("cod_"): await create_cod(update, int(data.split("_", 1)[1])); return
        if data.startswith("online_"):
            await q.message.reply_text("💳 Online payment gateway is configured, but the hosted Telegram payment page is not enabled yet. No fake payment confirmation is created.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("💵 Use COD", callback_data=data.replace("online_", "cod_"))], [InlineKeyboardButton("⬅️ Checkout", callback_data="checkout")]])); return
        if data == "orders": await show_orders(update); return
        if data.startswith("order_"): await show_order_details(update, data.split("_", 1)[1]); return
        if data.startswith("track_"): await show_tracking(update, data.split("_", 1)[1]); return
        if data == "address": await show_addresses(update); return
        if data == "add_address":
            context.user_data["address_mode"] = True
            await q.message.reply_text("📍 इस format में भेजें:\n`House/Street | City | Pincode`", parse_mode="Markdown"); return
        if data.startswith("useaddress_"):
            address = await make_default_address(user.id, int(data.split("_", 1)[1])); await q.message.reply_text(f"✅ {address.city} address default set हो गया।"); return
        if data == "noop": return
        await q.message.reply_text("❌ Unknown option. /start चलाएँ।")
    except Exception:
        logger.exception("CALLBACK HANDLER FAILED: %s", data)
        await q.message.reply_text("❌ Button process करते समय error आया। Please try again.")


async def show_favorites(update):
    favorites = await get_favorite_products(update.effective_user.id)
    products = [f.product for f in favorites if f.product.available and available(f.product)]
    if not products:
        await update.effective_message.reply_text("❤️ Favorites खाली हैं।", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]])); return
    await update.effective_message.reply_text("❤️ *My Favorites*", parse_mode="Markdown")
    for p in products:
        caption = f"🍬 *{p.name}*\n💰 {price_text(p)}\n{stock_text(p)}"
        if p.image:
            try: await update.effective_message.reply_photo(photo=p.image.path, caption=caption, parse_mode="Markdown")
            except Exception: await update.effective_message.reply_text(caption, parse_mode="Markdown")
        else: await update.effective_message.reply_text(caption, parse_mode="Markdown")
        await update.effective_message.reply_text("Choose:", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Open Product", callback_data=f"product_{p.id}")], [InlineKeyboardButton("💔 Remove Favorite", callback_data=f"favorite_{p.id}")]]))


@sync_to_async
def get_favorite_products(user_id):
    return list(Favorite.objects.filter(customer__telegram_user_id=user_id).select_related("product"))


async def text_handler(update, context):
    if not update.message or not update.effective_user: return
    text = (update.message.text or "").strip()
    if context.user_data.get("address_mode"):
        parts = [x.strip() for x in text.split("|")]
        if len(parts) != 3 or not parts[2].isdigit():
            await update.message.reply_text("❌ Format: `House/Street | City | Pincode`", parse_mode="Markdown"); return
        address = await save_new_address(update.effective_user.id, parts[0], parts[1], parts[2])
        context.user_data["address_mode"] = False
        await update.message.reply_text(f"✅ Address saved!\n📍 {address.address}, {address.city} - {address.pincode}", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("💳 Checkout", callback_data="checkout")], [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")]])); return
    if context.user_data.get("search_mode"):
        context.user_data["search_mode"] = False; await search_results(update, text); return
    if text in ["🛍 दुकान देखें", "🛍 Shop"]: await show_categories(update); return
    if text == "🔎 Search": await search_menu(update, context); return
    if text in ["🛒 मेरी Cart", "🛒 My Cart"]: await show_cart(update); return
    if text == "❤️ Favorites": await show_favorites(update); return
    if text in ["📦 मेरे Orders", "📦 My Orders"]: await show_orders(update); return
    if text in ["📍 मेरा Address", "📍 My Address"]: await show_addresses(update); return
    if text == "🌐 Language": await update.message.reply_text("🌐 भाषा चुनें:", reply_markup=language_keyboard()); return
    if text == "☎️ Help":
        await update.message.reply_text("☎️ *Help*\n\n🛍 Shop\n🔎 Search\n🛒 Cart\n❤️ Favorites\n📦 Orders & Tracking\n📍 Address", parse_mode="Markdown"); return
    await update.message.reply_text("कृपया menu से option चुनें या /start चलाएँ।")


def register_handlers(application):
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(callback_handler))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
    application.add_error_handler(lambda update, context: logger.error("Telegram update error", exc_info=context.error))
