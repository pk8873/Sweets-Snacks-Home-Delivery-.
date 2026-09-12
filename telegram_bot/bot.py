import logging
from decimal import Decimal, ROUND_HALF_UP

from asgiref.sync import sync_to_async
from django.conf import settings

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

from cart.models import Cart, CartItem
from customers.models import Customer, CustomerAddress
from products.models import Category, Favorite, Product
from orders.services import (
    build_order_tracking,
    create_order_async,
    get_customer_orders,
    get_order_details,
)


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
        logger.info("Telegram application created and handlers registered.")

    return _application


async def initialize_telegram_application():
    global _application_initialized, _application_started

    application = get_telegram_application()

    if not _application_initialized:
        await application.initialize()
        _application_initialized = True
        logger.info("Telegram application initialized.")

    if not _application_started:
        await application.start()
        _application_started = True
        logger.info("Telegram application started.")

    return application


# ============================================================
# COMMON HELPERS
# ============================================================


def money(value):
    return f"₹{Decimal(value):,.2f}"


def weight_label(grams):
    grams = int(grams)
    if grams >= 1000 and grams % 1000 == 0:
        return f"{grams // 1000} kg"
    return f"{grams} g"


def weight_options(product):
    base = max(int(product.weight_grams or 1000), 250)
    options = [250, 500, 750, 1000]
    options = [value for value in options if value <= base]
    if base not in options:
        options.append(base)
    return sorted(set(options))


def price_for_weight(product, grams):
    base = max(int(product.weight_grams or 1000), 1)
    value = Decimal(product.price) * Decimal(int(grams)) / Decimal(base)
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def product_stock_available(product):
    if product.is_weight_based:
        return product.stock_grams > 0
    return product.stock > 0


def product_stock_text(product):
    if product.is_weight_based:
        return f"📦 Available: {weight_label(product.stock_grams)}"
    return f"📦 Available: {product.stock}"


def product_price_text(product):
    if product.is_weight_based:
        return f"{money(price_for_weight(product, 250))} / 250 g"
    return money(product.price)


# ============================================================
# CUSTOMER
# ============================================================


@sync_to_async
def get_or_create_customer(telegram_user):
    customer, _ = Customer.objects.get_or_create(
        telegram_user_id=telegram_user.id,
        defaults={
            "telegram_username": telegram_user.username or "",
            "name": telegram_user.full_name or "Customer",
        },
    )

    changed = False
    if telegram_user.username and customer.telegram_username != telegram_user.username:
        customer.telegram_username = telegram_user.username
        changed = True
    if telegram_user.full_name and customer.name != telegram_user.full_name:
        customer.name = telegram_user.full_name
        changed = True

    if changed:
        customer.save(update_fields=["telegram_username", "name", "updated_at"])

    return customer


@sync_to_async
def get_customer(telegram_user_id):
    return Customer.objects.filter(telegram_user_id=telegram_user_id).first()


@sync_to_async
def update_customer_language(telegram_user_id, language):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    customer.language = language
    customer.save(update_fields=["language", "updated_at"])
    return customer


# ============================================================
# MENUS
# ============================================================


def language_keyboard():
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🇮🇳 हिंदी", callback_data="language_hi"),
            InlineKeyboardButton("🇬🇧 English", callback_data="language_en"),
        ]
    ])


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


async def send_language_selection(update):
    if update.effective_message:
        await update.effective_message.reply_text(
            "🍬 *Sweet & Snacks*\n\n"
            "Welcome! / स्वागत है!\n"
            "Please select your language.\nकृपया भाषा चुनें।",
            parse_mode="Markdown",
            reply_markup=language_keyboard(),
        )


async def send_menu(update, customer):
    message = update.effective_message
    if not message:
        return

    if customer.language == "en":
        text = (
            f"🍬 *Welcome, {customer.name}!\n\n"
            "Fresh sweets & snacks, delivered to your door.\n"
            "Choose an option below to continue.*"
        )
        keyboard = english_menu()
    else:
        text = (
            f"🍬 *{customer.name} जी, Sweet & Snacks में आपका स्वागत है!*\n\n"
            "ताज़ी मिठाई और snacks घर तक मंगाइए।\n"
            "नीचे से अपना option चुनें।"
        )
        keyboard = hindi_menu()

    await message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)


# ============================================================
# START
# ============================================================


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        user = update.effective_user
        if not user:
            return

        context.user_data.clear()
        customer = await get_or_create_customer(user)

        if not customer.language:
            await send_language_selection(update)
            return

        await send_menu(update, customer)
    except Exception:
        logger.exception("START handler failed.")
        if update.effective_message:
            await update.effective_message.reply_text("❌ कुछ गलत हुआ। कृपया /start फिर से भेजें।")


# ============================================================
# CATEGORIES / PRODUCT GRID
# ============================================================


@sync_to_async
def get_categories():
    return list(Category.objects.filter(active=True).order_by("name"))


@sync_to_async
def get_category_products(category_id):
    return list(
        Product.objects.filter(
            category_id=category_id,
            available=True,
        ).select_related("category").order_by("name")
    )


@sync_to_async
def get_product(product_id):
    return Product.objects.filter(id=product_id, available=True).select_related("category").first()


@sync_to_async
def get_search_suggestions(search_text=""):
    qs = Product.objects.filter(available=True)
    if search_text:
        qs = qs.filter(name__icontains=search_text)
    return list(qs.order_by("name")[:8])


async def show_categories(update):
    message = update.effective_message
    if not message:
        return

    categories = await get_categories()
    if not categories:
        await message.reply_text("📂 अभी कोई category उपलब्ध नहीं है।")
        return

    rows = []
    for index in range(0, len(categories), 2):
        row = []
        for category in categories[index:index + 2]:
            row.append(
                InlineKeyboardButton(
                    f"📂 {category.name}",
                    callback_data=f"category_{category.id}",
                )
            )
        rows.append(row)

    rows.append([
        InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")
    ])

    await message.reply_text(
        "🛍 *Shop by Category*\n\nअपनी पसंद की category चुनें:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(rows),
    )


def product_list_keyboard(products, favorites=None):
    favorites = favorites or set()
    rows = []
    for index in range(0, len(products), 2):
        row = []
        for product in products[index:index + 2]:
            heart = "❤️" if product.id in favorites else "♡"
            row.append(
                InlineKeyboardButton(
                    f"🛍 {product.name[:16]} {heart}",
                    callback_data=f"product_{product.id}",
                )
            )
        rows.append(row)
    rows.append([
        InlineKeyboardButton("🔎 Search", callback_data="search_menu"),
        InlineKeyboardButton("⬅️ Categories", callback_data="categories"),
    ])
    return InlineKeyboardMarkup(rows)


@sync_to_async
def get_favorite_ids(telegram_user_id, product_ids=None):
    qs = Favorite.objects.filter(customer__telegram_user_id=telegram_user_id)
    if product_ids is not None:
        qs = qs.filter(product_id__in=product_ids)
    return set(qs.values_list("product_id", flat=True))


async def show_category_products(update, category_id):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    products = await get_category_products(category_id)
    products = [product for product in products if product_stock_available(product)]

    if not products:
        await message.reply_text(
            "😔 इस category में अभी कोई product उपलब्ध नहीं है।",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Categories", callback_data="categories")]
            ]),
        )
        return

    favorite_ids = await get_favorite_ids(user.id, [p.id for p in products])

    # Telegram does not support independent image+button cards side-by-side in one message.
    # We therefore send products in pairs, each with its own image, then a compact two-column
    # product selector below the pair. Clicking a product opens the large detail view.
    await message.reply_text(
        f"🛍 *{products[0].category.name}*\n\n"
        "दो product एक साथ browse करें — product पर tap करके पूरा view खोलें।",
        parse_mode="Markdown",
    )

    for index in range(0, len(products), 2):
        pair = products[index:index + 2]
        for product in pair:
            caption = (
                f"🍬 *{product.name}*\n"
                f"💰 {product_price_text(product)}\n"
                f"{product_stock_text(product)}"
            )
            try:
                if product.image:
                    await message.reply_photo(
                        photo=product.image.path,
                        caption=caption,
                        parse_mode="Markdown",
                    )
                else:
                    await message.reply_text(caption, parse_mode="Markdown")
            except Exception:
                logger.exception("Product image failed: product_id=%s", product.id)
                await message.reply_text(caption, parse_mode="Markdown")

        buttons = []
        for product in pair:
            heart = "❤️" if product.id in favorite_ids else "♡"
            buttons.append(
                InlineKeyboardButton(
                    f"🛍 Buy {product.name[:12]}",
                    callback_data=f"product_{product.id}",
                )
            )
        if len(buttons) == 1:
            buttons.append(InlineKeyboardButton("⬅️ Back", callback_data=f"category_{category_id}"))
        await message.reply_text(
            "Choose a product:",
            reply_markup=InlineKeyboardMarkup([
                buttons,
                [
                    InlineKeyboardButton(f"{heart if False else '❤️'} Favorites", callback_data="favorites"),
                    InlineKeyboardButton("⬅️ Back", callback_data="categories"),
                ],
            ]),
        )


# ============================================================
# PRODUCT DETAIL / QUANTITY
# ============================================================


def detail_keyboard(product, favorite=False, selected_weight=None):
    favorite_text = "💔 Remove Favorite" if favorite else "❤️ Favorite"
    rows = []

    if product.is_weight_based:
        weight_buttons = [
            InlineKeyboardButton(
                ("✅ " if selected_weight == grams else "") + weight_label(grams),
                callback_data=f"weight_{product.id}_{grams}",
            )
            for grams in weight_options(product)
        ]
        for index in range(0, len(weight_buttons), 2):
            rows.append(weight_buttons[index:index + 2])

        if selected_weight:
            rows.append([
                InlineKeyboardButton("➖", callback_data=f"qtydec_{product.id}"),
                InlineKeyboardButton(
                    f"Qty: {int(getattr(product, '_display_qty', 1))}",
                    callback_data="noop",
                ),
                InlineKeyboardButton("➕", callback_data=f"qtyinc_{product.id}"),
            ])
    else:
        rows.append([
            InlineKeyboardButton("➖", callback_data=f"qtydec_{product.id}"),
            InlineKeyboardButton("Qty: 1", callback_data="noop"),
            InlineKeyboardButton("➕", callback_data=f"qtyinc_{product.id}"),
        ])

    rows.extend([
        [InlineKeyboardButton("🛒 Buy Now", callback_data=f"buynow_{product.id}")],
        [
            InlineKeyboardButton(favorite_text, callback_data=f"favorite_{product.id}"),
            InlineKeyboardButton("🛒 Add to Cart", callback_data=f"addcart_{product.id}"),
        ],
        [InlineKeyboardButton("⬅️ Back", callback_data="categories")],
    ])
    return InlineKeyboardMarkup(rows)


async def show_product_details(update, product_id, edit=False):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    product = await get_product(product_id)
    if not product or not product_stock_available(product):
        await message.reply_text("❌ यह product अभी available नहीं है।")
        return

    selected_weight = context_weight = None
    selected_qty = 1
    if update.callback_query:
        context = update.callback_query._bot_data if False else None
    # Actual per-user selection is kept in Telegram context.user_data by callback_handler.
    # The values are injected through the helper below when called from callbacks.
    return await render_product_detail(update, product, selected_weight, selected_qty)


async def render_product_detail(update, product, selected_weight=None, selected_qty=1):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    favorite = await is_favorite(user.id, product.id)

    if product.is_weight_based:
        if selected_weight is None:
            selected_weight = 250
        unit_price = price_for_weight(product, selected_weight)
        selected_total = unit_price * selected_qty
        weight_line = f"⚖️ Selected: *{weight_label(selected_weight)}*\n"
    else:
        unit_price = Decimal(product.price)
        selected_total = unit_price * selected_qty
        weight_line = ""

    text = (
        f"🍬 *{product.name}*\n\n"
        f"{product.description or 'Freshly prepared and carefully packed.'}\n\n"
        f"💰 Price: *{money(unit_price)}*\n"
        f"{weight_line}"
        f"🔢 Quantity: *{selected_qty}*\n"
        f"🧾 Total: *{money(selected_total)}*\n"
        f"{product_stock_text(product)}"
    )

    keyboard = detail_keyboard(product, favorite, selected_weight)
    # Replace the static quantity label with the real selected quantity.
    rows = keyboard.inline_keyboard
    for row in rows:
        for button in row:
            if button.callback_data == "noop":
                button.text = f"Qty: {selected_qty}"

    try:
        if product.image:
            await message.reply_photo(
                photo=product.image.path,
                caption=text,
                parse_mode="Markdown",
                reply_markup=keyboard,
            )
        else:
            await message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception:
        logger.exception("Product detail image failed: product_id=%s", product.id)
        await message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)


@sync_to_async
def is_favorite(telegram_user_id, product_id):
    return Favorite.objects.filter(
        customer__telegram_user_id=telegram_user_id,
        product_id=product_id,
    ).exists()


@sync_to_async
def toggle_favorite(telegram_user_id, product_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    product = Product.objects.filter(id=product_id).first()
    if not product:
        return False, "not_found"

    favorite = Favorite.objects.filter(customer=customer, product=product).first()
    if favorite:
        favorite.delete()
        return False, "removed"

    Favorite.objects.create(customer=customer, product=product)
    return True, "added"


# ============================================================
# CART
# ============================================================


@sync_to_async
def add_product_to_cart(telegram_user_id, product_id, quantity=1, quantity_grams=0):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    product = Product.objects.filter(id=product_id).first()

    if not product:
        return False, "not_found", 0
    if not product.available:
        return False, "unavailable", 0

    if product.is_weight_based:
        if not quantity_grams or quantity_grams not in weight_options(product):
            return False, "weight_required", 0
        if quantity * quantity_grams > product.stock_grams:
            return False, "stock_limit", 0
    elif quantity > product.stock:
        return False, "stock_limit", product.stock

    cart, _ = Cart.objects.get_or_create(customer=customer)
    item, created = CartItem.objects.get_or_create(
        cart=cart,
        product=product,
        defaults={
            "quantity": quantity,
            "quantity_grams": quantity_grams if product.is_weight_based else 0,
            "price": product.price,
        },
    )

    if not created:
        if product.is_weight_based:
            item.quantity_grams = quantity_grams
        item.quantity += quantity
        if product.is_weight_based and item.quantity * item.quantity_grams > product.stock_grams:
            return False, "stock_limit", item.quantity - quantity
        if not product.is_weight_based and item.quantity > product.stock:
            return False, "stock_limit", item.quantity - quantity
        item.price = product.price
        item.save()

    return True, "added", item.quantity


@sync_to_async
def get_cart(telegram_user_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    cart, _ = Cart.objects.get_or_create(customer=customer)
    return cart, list(cart.items.select_related("product").all())


@sync_to_async
def update_cart_quantity(telegram_user_id, product_id, delta):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    item = CartItem.objects.select_related("product").filter(
        cart__customer=customer,
        product_id=product_id,
    ).first()
    if not item:
        return False, "not_found", 0

    new_quantity = item.quantity + delta
    if new_quantity <= 0:
        item.delete()
        return True, "removed", 0

    product = item.product
    if product.is_weight_based:
        if new_quantity * item.quantity_grams > product.stock_grams:
            return False, "stock_limit", item.quantity
    elif new_quantity > product.stock:
        return False, "stock_limit", item.quantity

    item.quantity = new_quantity
    item.price = product.price
    item.save()
    return True, "updated", new_quantity


@sync_to_async
def remove_cart_item(telegram_user_id, product_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    deleted, _ = CartItem.objects.filter(cart__customer=customer, product_id=product_id).delete()
    return deleted > 0


@sync_to_async
def clear_cart(telegram_user_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    CartItem.objects.filter(cart__customer=customer).delete()


async def show_cart(update):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    _, items = await get_cart(user.id)
    if not items:
        await message.reply_text(
            "🛒 *Your Cart is empty*\n\nअपनी पसंद का product add करें।",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]
            ]),
        )
        return

    lines = ["🛒 *Your Cart*", ""]
    rows = []
    total = Decimal("0.00")

    for item in items:
        product = item.product
        if product.is_weight_based and item.quantity_grams:
            unit_text = weight_label(item.quantity_grams)
            unit_price = price_for_weight(product, item.quantity_grams)
            subtotal = unit_price * item.quantity
            lines.append(f"🍬 {product.name}\n   {item.quantity} × {unit_text} × {money(unit_price)} = *{money(subtotal)}*")
        else:
            subtotal = item.price * item.quantity
            lines.append(f"🍬 {product.name}\n   {item.quantity} × {money(item.price)} = *{money(subtotal)}*")

        total += subtotal
        rows.append([
            InlineKeyboardButton("➖", callback_data=f"cartdec_{product.id}"),
            InlineKeyboardButton(f"{item.quantity} × {product.name[:12]}", callback_data=f"product_{product.id}"),
            InlineKeyboardButton("➕", callback_data=f"cartinc_{product.id}"),
        ])
        rows.append([
            InlineKeyboardButton("🗑 Remove", callback_data=f"cartremove_{product.id}"),
        ])

    lines.extend(["", f"💰 *Subtotal: {money(total)}*"])
    rows.extend([
        [InlineKeyboardButton("💳 Checkout", callback_data="checkout")],
        [InlineKeyboardButton("🛍 Continue Shopping", callback_data="categories")],
        [InlineKeyboardButton("🧹 Clear Cart", callback_data="clear_cart")],
    ])

    await message.reply_text("\n".join(lines), parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(rows))


# ============================================================
# FAVORITES
# ============================================================


@sync_to_async
def get_favorite_products(telegram_user_id):
    return list(
        Favorite.objects.filter(customer__telegram_user_id=telegram_user_id)
        .select_related("product")
    )


async def show_favorites(update):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    favorites = await get_favorite_products(user.id)
    products = [item.product for item in favorites if item.product.available and product_stock_available(item.product)]

    if not products:
        await message.reply_text(
            "❤️ *Favorites खाली हैं*\n\nजिस product को पसंद करें, उसके detail page पर ❤️ Favorite दबाएँ।",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]
            ]),
        )
        return

    await message.reply_text(f"❤️ *My Favorites — {len(products)} product(s)*", parse_mode="Markdown")
    for product in products:
        caption = f"🍬 *{product.name}*\n💰 {product_price_text(product)}\n{product_stock_text(product)}"
        try:
            if product.image:
                await message.reply_photo(photo=product.image.path, caption=caption, parse_mode="Markdown")
            else:
                await message.reply_text(caption, parse_mode="Markdown")
        except Exception:
            await message.reply_text(caption, parse_mode="Markdown")
        await message.reply_text(
            "Choose:",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🛍 Buy Now", callback_data=f"product_{product.id}")],
                [InlineKeyboardButton("💔 Remove Favorite", callback_data=f"favorite_{product.id}")],
            ]),
        )

    await message.reply_text(
        "",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⬅️ Main Menu", callback_data="main_menu")]
        ]),
    )


# ============================================================
# SEARCH + SUGGESTIONS
# ============================================================


async def show_search_menu(update, search_text=""):
    message = update.effective_message
    if not message:
        return

    products = await get_search_suggestions(search_text)
    rows = []
    for product in products:
        rows.append([
            InlineKeyboardButton(
                f"🔎 {product.name[:30]}",
                callback_data=f"searchpick_{product.id}",
            )
        ])
    rows.append([InlineKeyboardButton("⬅️ Back", callback_data="main_menu")])

    if search_text:
        title = f"🔎 *Suggestions for: {search_text}*"
    else:
        title = "🔎 *What are you looking for?*\n\nStart typing a product name, or choose a suggestion:"

    await message.reply_text(title, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(rows))


async def show_search_results(update, search_text):
    products = await get_search_suggestions(search_text)
    message = update.effective_message
    if not message:
        return

    if not products:
        await message.reply_text(
            f"😔 '{search_text}' के लिए कोई product नहीं मिला।",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔎 Search Again", callback_data="search_menu")],
                [InlineKeyboardButton("⬅️ Main Menu", callback_data="main_menu")],
            ]),
        )
        return

    await message.reply_text(f"🔎 *Search Results: {search_text}*", parse_mode="Markdown")
    for product in products:
        caption = f"🍬 *{product.name}*\n💰 {product_price_text(product)}\n{product_stock_text(product)}"
        try:
            if product.image:
                await message.reply_photo(photo=product.image.path, caption=caption, parse_mode="Markdown")
            else:
                await message.reply_text(caption, parse_mode="Markdown")
        except Exception:
            await message.reply_text(caption, parse_mode="Markdown")
        await message.reply_text(
            "",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🛍 Open Product", callback_data=f"product_{product.id}")]
            ]),
        )


# ============================================================
# ADDRESS
# ============================================================


@sync_to_async
def get_addresses(telegram_user_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    return list(CustomerAddress.objects.filter(customer=customer))


@sync_to_async
def get_default_address(telegram_user_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    return CustomerAddress.objects.filter(customer=customer, is_default=True).first()


@sync_to_async
def save_address(telegram_user_id, address_text, city, pincode):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    CustomerAddress.objects.filter(customer=customer).update(is_default=False)
    return CustomerAddress.objects.create(
        customer=customer,
        label="home",
        address=address_text,
        city=city,
        pincode=pincode,
        is_default=True,
    )


async def show_addresses(update):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    addresses = await get_addresses(user.id)
    rows = []
    for address in addresses:
        label = f"📍 {address.city} - {address.pincode}"
        if address.is_default:
            label = "✅ " + label
        rows.append([InlineKeyboardButton(label, callback_data=f"useaddress_{address.id}")])

    rows.extend([
        [InlineKeyboardButton("➕ Add New Address", callback_data="add_address")],
        [InlineKeyboardButton("⬅️ Main Menu", callback_data="main_menu")],
    ])

    await message.reply_text(
        "📍 *Delivery Addresses*\n\nDefault address checkout में automatically use होगा।",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(rows),
    )


@sync_to_async
def set_default_address(telegram_user_id, address_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    address = CustomerAddress.objects.get(id=address_id, customer=customer)
    CustomerAddress.objects.filter(customer=customer).update(is_default=False)
    address.is_default = True
    address.save(update_fields=["is_default"])
    return address


# ============================================================
# CHECKOUT / PAYMENT
# ============================================================


async def show_checkout(update):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    _, items = await get_cart(user.id)
    if not items:
        await message.reply_text("🛒 Cart खाली है। पहले product add करें।")
        return

    address = await get_default_address(user.id)
    if not address:
        await message.reply_text(
            "📍 *Delivery address required*\n\nपहले अपना address save करें।",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("➕ Add Address", callback_data="add_address")],
                [InlineKeyboardButton("⬅️ Cart", callback_data="cart")],
            ]),
        )
        return

    total = Decimal("0.00")
    lines = ["💳 *Checkout*", ""]
    for item in items:
        product = item.product
        if product.is_weight_based and item.quantity_grams:
            unit_price = price_for_weight(product, item.quantity_grams)
            subtotal = unit_price * item.quantity
            lines.append(f"• {product.name} — {item.quantity} × {weight_label(item.quantity_grams)} = {money(subtotal)}")
        else:
            subtotal = item.price * item.quantity
            lines.append(f"• {product.name} — {item.quantity} × {money(item.price)} = {money(subtotal)}")
        total += subtotal

    lines.extend([
        "",
        f"💰 *Total: {money(total)}*",
        "",
        f"📍 {address.address}, {address.city} - {address.pincode}",
        "",
        "Payment method चुनें:",
    ])

    await message.reply_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("💵 Cash on Delivery", callback_data=f"cod_{address.id}")],
            [InlineKeyboardButton("💳 Online Payment", callback_data=f"online_{address.id}")],
            [InlineKeyboardButton("🛒 Edit Cart", callback_data="cart")],
            [InlineKeyboardButton("❌ Cancel", callback_data="categories")],
        ]),
    )


async def create_cod_order(update, address_id):
    user = update.effective_user
    message = update.effective_message
    customer = await get_customer(user.id)
    if not customer:
        await message.reply_text("❌ Customer account नहीं मिला। /start चलाएँ।")
        return

    try:
        order = await create_order_async(
            customer_id=customer.id,
            address_id=address_id,
            payment_method="cod",
        )
    except Exception as exc:
        logger.exception("COD order creation failed")
        await message.reply_text(f"❌ Order नहीं बन सका: {exc}")
        return

    await message.reply_text(
        f"🎉 *Order Confirmed!*\n\n"
        f"🆔 Order ID: *{order.order_id}*\n"
        f"💵 Payment: *Cash on Delivery*\n"
        f"💰 Total: *{money(order.total_amount)}*\n\n"
        "आपका order अब tracking में दिखाई देगा।",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")],
            [InlineKeyboardButton("📦 My Orders", callback_data="orders")],
            [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
        ]),
    )


async def show_online_payment(update, address_id):
    # Online payment backend remains intentionally separated from order tracking.
    # The current payments app has no hosted checkout page yet, so do not create a
    # fake payment link. The customer receives a clear gateway status instead.
    await update.effective_message.reply_text(
        "💳 *Online Payment*\n\n"
        "Razorpay gateway is configured in the project, but a hosted Telegram payment page "
        "is not enabled yet. No payment will be marked as paid until gateway verification succeeds.\n\n"
        "Please use Cash on Delivery for now, or complete the online gateway setup next.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("💵 Use Cash on Delivery", callback_data=f"cod_{address_id}")],
            [InlineKeyboardButton("⬅️ Back to Checkout", callback_data="checkout")],
        ]),
    )


# ============================================================
# ORDERS / TRACKING — SAME STATUS FLOW
# ============================================================


async def show_orders(update):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    customer = await get_customer(user.id)
    if not customer:
        await message.reply_text("❌ Customer account नहीं मिला। /start चलाएँ।")
        return

    orders = await get_customer_orders(customer.id)
    if not orders:
        await message.reply_text(
            "📦 *No orders yet*\n\nजब आप order करेंगे, वह यहाँ दिखाई देगा।",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]
            ]),
        )
        return

    await message.reply_text("📦 *My Orders*", parse_mode="Markdown")
    for order in orders[:10]:
        await message.reply_text(
            f"🆔 *{order.order_id}*\n"
            f"📌 {order.get_order_status_display()}\n"
            f"💰 {money(order.total_amount)}\n"
            f"🗓 {order.created_at:%d-%m-%Y %H:%M}",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📋 Details", callback_data=f"order_{order.order_id}")],
                [InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")],
            ]),
        )


async def show_order_details(update, order_id):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    customer = await get_customer(user.id)
    if not customer:
        await message.reply_text("❌ Customer account नहीं मिला।")
        return

    details = await get_order_details(customer.id, order_id)
    if not details:
        await message.reply_text("❌ Order नहीं मिला।")
        return

    order = details["order"]
    items = details["items"]
    lines = [
        f"📦 *Order #{order.order_id}*",
        "",
        f"📌 Status: {order.get_order_status_display()}",
        f"💳 Payment: {order.get_payment_method_display()}",
        f"📍 Address: {order.address}",
        "",
        "🛍 *Items:*",
    ]

    for item in items:
        if item.quantity_grams:
            lines.append(
                f"• {item.product_name} × {item.quantity} × {weight_label(item.quantity_grams)} = {money(item.subtotal)}"
            )
        else:
            lines.append(f"• {item.product_name} × {item.quantity} = {money(item.subtotal)}")

    lines.append(f"\n💰 *Total: {money(order.total_amount)}*")

    await message.reply_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("📍 Track Order", callback_data=f"track_{order.order_id}")],
            [InlineKeyboardButton("⬅️ My Orders", callback_data="orders")],
        ]),
    )


async def show_order_tracking(update, order_id):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    customer = await get_customer(user.id)
    if not customer:
        await message.reply_text("❌ Customer account नहीं मिला।")
        return

    details = await get_order_details(customer.id, order_id)
    if not details:
        await message.reply_text("❌ Order नहीं मिला।")
        return

    order = details["order"]
    tracking = await build_order_tracking(order)
    lines = [f"📦 *Order Tracking*\n\n🆔 {order.order_id}", ""]
    for _, label in tracking["steps"]:
        lines.append(label)

    await message.reply_text(
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⬅️ My Orders", callback_data="orders")],
            [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
        ]),
    )


# ============================================================
# CALLBACK HANDLER
# ============================================================


async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not query:
        return

    try:
        await query.answer()
        data = query.data or ""
        user = update.effective_user
        if not user:
            return

        logger.info("CALLBACK RECEIVED: %s from user=%s", data, user.id)

        if data in ("noop",):
            return

        if data == "language_hi":
            customer = await update_customer_language(user.id, "hi")
            await query.edit_message_text("🇮🇳 भाषा हिंदी में सेट कर दी गई है।")
            await send_menu(update, customer)
            return

        if data == "language_en":
            customer = await update_customer_language(user.id, "en")
            await query.edit_message_text("🇬🇧 Language set to English.")
            await send_menu(update, customer)
            return

        if data == "main_menu":
            customer = await get_customer(user.id)
            if customer:
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
            await clear_cart(user.id)
            await query.message.reply_text("🧹 Cart cleared successfully.")
            return

        if data.startswith("product_"):
            product_id = int(data.split("_", 1)[1])
            context.user_data[f"product_{product_id}_qty"] = 1
            product = await get_product(product_id)
            if not product:
                await query.message.reply_text("❌ Product नहीं मिला।")
                return
            selected_weight = 250 if product.is_weight_based else None
            context.user_data[f"product_{product_id}_weight"] = selected_weight
            await render_product_detail(update, product, selected_weight, 1)
            return

        if data.startswith("weight_"):
            _, product_id_text, grams_text = data.split("_")
            product_id = int(product_id_text)
            grams = int(grams_text)
            product = await get_product(product_id)
            if not product:
                return
            context.user_data[f"product_{product_id}_weight"] = grams
            context.user_data[f"product_{product_id}_qty"] = 1
            await render_product_detail(update, product, grams, 1)
            return

        if data.startswith("qtyinc_") or data.startswith("qtydec_"):
            product_id = int(data.split("_", 1)[1])
            product = await get_product(product_id)
            if not product:
                return
            key = f"product_{product_id}_qty"
            qty = int(context.user_data.get(key, 1))
            if data.startswith("qtyinc_"):
                qty += 1
            else:
                qty = max(1, qty - 1)
            context.user_data[key] = qty
            weight = context.user_data.get(f"product_{product_id}_weight") if product.is_weight_based else None
            await render_product_detail(update, product, weight, qty)
            return

        if data.startswith("addcart_") or data.startswith("buynow_"):
            action, product_id_text = data.split("_", 1)
            product_id = int(product_id_text)
            product = await get_product(product_id)
            if not product:
                await query.message.reply_text("❌ Product नहीं मिला।")
                return

            qty = int(context.user_data.get(f"product_{product_id}_qty", 1))
            grams = int(context.user_data.get(f"product_{product_id}_weight", 250)) if product.is_weight_based else 0

            ok, reason, current_qty = await add_product_to_cart(user.id, product_id, qty, grams)
            messages = {
                "added": f"✅ *{product.name}* Cart में add हो गया। Quantity: {current_qty}",
                "unavailable": "❌ यह product available नहीं है।",
                "stock_limit": "⚠️ Requested quantity available stock से अधिक है।",
                "weight_required": "⚖️ पहले weight चुनें।",
                "not_found": "❌ Product नहीं मिला।",
            }
            await query.message.reply_text(messages.get(reason, "❌ Cart update failed."), parse_mode="Markdown")

            if action == "buynow_"[:-1]:
                await show_checkout(update)
            elif action == "buynow":
                await show_checkout(update)
            return

        if data.startswith("favorite_"):
            product_id = int(data.split("_", 1)[1])
            added, reason = await toggle_favorite(user.id, product_id)
            if reason == "added":
                await query.message.reply_text("❤️ Product Favorites में add हो गया।")
            elif reason == "removed":
                await query.message.reply_text("💔 Product Favorites से remove हो गया।")
            else:
                await query.message.reply_text("❌ Product नहीं मिला।")
            return

        if data.startswith("cartinc_") or data.startswith("cartdec_"):
            product_id = int(data.split("_", 1)[1])
            delta = 1 if data.startswith("cartinc_") else -1
            ok, reason, qty = await update_cart_quantity(user.id, product_id, delta)
            if reason == "stock_limit":
                await query.message.reply_text(f"⚠️ Maximum available quantity: {qty}")
            elif reason == "removed":
                await query.message.reply_text("🗑 Product Cart से remove हो गया।")
            elif ok:
                await query.message.reply_text(f"✅ Cart quantity updated: {qty}")
            await show_cart(update)
            return

        if data.startswith("cartremove_"):
            product_id = int(data.split("_", 1)[1])
            await remove_cart_item(user.id, product_id)
            await query.message.reply_text("🗑 Product removed from Cart.")
            await show_cart(update)
            return

        if data == "checkout":
            await show_checkout(update)
            return

        if data.startswith("cod_"):
            await create_cod_order(update, int(data.split("_", 1)[1]))
            return

        if data.startswith("online_"):
            await show_online_payment(update, int(data.split("_", 1)[1]))
            return

        if data == "orders":
            await show_orders(update)
            return

        if data.startswith("order_"):
            await show_order_details(update, data.split("_", 1)[1])
            return

        if data.startswith("track_"):
            await show_order_tracking(update, data.split("_", 1)[1])
            return

        if data == "search_menu":
            context.user_data["search_mode"] = True
            await show_search_menu(update)
            await query.message.reply_text("🔎 Product name type करें:")
            return

        if data.startswith("searchpick_"):
            product_id = int(data.split("_", 1)[1])
            context.user_data[f"product_{product_id}_qty"] = 1
            product = await get_product(product_id)
            if product:
                weight = 250 if product.is_weight_based else None
                context.user_data[f"product_{product_id}_weight"] = weight
                await render_product_detail(update, product, weight, 1)
            return

        if data == "add_address":
            context.user_data["address_mode"] = True
            await query.message.reply_text(
                "📍 *Add Address*\n\n"
                "एक ही message में इस format में भेजें:\n"
                "`House/Street Address | City | Pincode`",
                parse_mode="Markdown",
            )
            return

        if data == "address":
            await show_addresses(update)
            return

        if data.startswith("useaddress_"):
            address = await set_default_address(user.id, int(data.split("_", 1)[1]))
            await query.message.reply_text(f"✅ {address.city} address default set हो गया।")
            return

        await query.message.reply_text("❌ Unknown button. /start चलाएँ।")

    except Exception:
        logger.exception("CALLBACK HANDLER FAILED.")
        try:
            await query.message.reply_text("❌ Button process करते समय error आया। Please try again.")
        except Exception:
            logger.exception("Could not send callback error message.")


# ============================================================
# TEXT HANDLER
# ============================================================


async def text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.effective_user:
        return

    text = (update.message.text or "").strip()
    if not text:
        return

    if context.user_data.get("address_mode"):
        parts = [part.strip() for part in text.split("|")]
        if len(parts) != 3 or not parts[2].isdigit() or not (4 <= len(parts[2]) <= 10):
            await update.message.reply_text(
                "❌ Format सही नहीं है।\n\nExample:\n`House No 12, Main Road | Bhopal | 462001`",
                parse_mode="Markdown",
            )
            return
        address = await save_address(update.effective_user.id, parts[0], parts[1], parts[2])
        context.user_data["address_mode"] = False
        await update.message.reply_text(
            f"✅ Address saved!\n📍 {address.address}, {address.city} - {address.pincode}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("💳 Go to Checkout", callback_data="checkout")],
                [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
            ]),
        )
        return

    if context.user_data.get("search_mode"):
        context.user_data["search_mode"] = False
        await show_search_results(update, text)
        return

    if text in ["🛍 दुकान देखें", "🛍 Shop"]:
        await show_categories(update)
        return

    if text == "🔎 Search":
        context.user_data["search_mode"] = True
        await show_search_menu(update)
        await update.message.reply_text("🔎 Product name type करें:")
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

    if text in ["🌐 Language"]:
        await update.message.reply_text("🌐 भाषा चुनें:", reply_markup=language_keyboard())
        return

    if text == "☎️ Help":
        await update.message.reply_text(
            "☎️ *Help*\n\n"
            "🛍 Shop — Products browse करें\n"
            "🔎 Search — Product search करें\n"
            "🛒 Cart — Quantity बदलें / checkout करें\n"
            "❤️ Favorites — पसंदीदा products\n"
            "📦 My Orders — Orders और tracking\n"
            "📍 Address — Delivery address save करें",
            parse_mode="Markdown",
        )
        return

    if text in ["📍 मेरा Address", "📍 My Address"]:
        await show_addresses(update)
        return

    await update.message.reply_text(
        "कृपया menu से कोई option चुनें या /start चलाएँ।",
    )


# ============================================================
# ERROR / HANDLERS
# ============================================================


async def error_handler(update, context):
    logger.error("Telegram update error", exc_info=context.error)


def register_handlers(application):
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(callback_handler))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
    application.add_error_handler(error_handler)
    logger.info("Telegram handlers registered.")
