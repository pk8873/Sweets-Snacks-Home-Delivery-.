import logging

from asgiref.sync import sync_to_async
from django.db import transaction
from django.conf import settings

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardMarkup,
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
from customers.models import Customer
from products.models import Category, Favorite, Product
from orders.models import Order
from orders.services import (
    get_customer_orders,
    get_order_details,
    build_order_tracking,
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

        _application = (
            Application.builder()
            .token(token)
            .updater(None)
            .build()
        )
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
        logger.info("Telegram application background processor started.")

    return application


# ============================================================
# CUSTOMER
# ============================================================


@sync_to_async

def get_or_create_customer(telegram_user):
    customer, created = Customer.objects.get_or_create(
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
    return Customer.objects.filter(
        telegram_user_id=telegram_user_id
    ).first()


@sync_to_async

def update_customer_language(telegram_user_id, language):
    customer = Customer.objects.get(
        telegram_user_id=telegram_user_id
    )
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
            "👋 Welcome to Sweet & Snacks!\n\n"
            "Please select your language.\n"
            "कृपया अपनी भाषा चुनें।",
            reply_markup=language_keyboard(),
        )


async def send_menu(update, customer):
    if not update.effective_message:
        return

    if customer.language == "en":
        await update.effective_message.reply_text(
            f"🍬 Welcome, {customer.name}!\n\nWhat would you like to do?",
            reply_markup=english_menu(),
        )
    else:
        await update.effective_message.reply_text(
            f"🍬 Sweet & Snacks में आपका स्वागत है, {customer.name}!\n\nआज क्या करना चाहते हैं?",
            reply_markup=hindi_menu(),
        )


# ============================================================
# START
# ============================================================


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        user = update.effective_user
        if not user:
            return

        logger.info("START received from telegram_user_id=%s", user.id)
        customer = await get_or_create_customer(user)

        if not customer.language:
            await send_language_selection(update)
            return

        await send_menu(update, customer)

    except Exception:
        logger.exception("START handler failed.")
        if update.effective_message:
            await update.effective_message.reply_text(
                "❌ Bot backend error. Please try /start again."
            )


# ============================================================
# CATEGORIES / PRODUCTS
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
            stock__gt=0,
        ).select_related("category").order_by("name")
    )


@sync_to_async

def get_product(product_id):
    return Product.objects.filter(
        id=product_id,
        available=True,
    ).first()


async def show_categories(update):
    categories = await get_categories()
    if not update.effective_message:
        return

    if not categories:
        await update.effective_message.reply_text(
            "📂 अभी कोई category उपलब्ध नहीं है।"
        )
        return

    buttons = []
    for category in categories:
        buttons.append([
            InlineKeyboardButton(
                f"📂 {category.name}",
                callback_data=f"category_{category.id}",
            )
        ])

    buttons.append([
        InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")
    ])

    await update.effective_message.reply_text(
        "🛍 कृपया category चुनें:",
        reply_markup=InlineKeyboardMarkup(buttons),
    )



def product_keyboard(product_id, favorite=False):
    favorite_text = "💔 Remove Favorite" if favorite else "❤️ Add Favorite"
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("➕ Add to Cart", callback_data=f"addcart_{product_id}")],
        [
            InlineKeyboardButton(favorite_text, callback_data=f"favorite_{product_id}"),
            InlineKeyboardButton("ℹ️ Details", callback_data=f"details_{product_id}"),
        ],
        [InlineKeyboardButton("⬅️ Categories", callback_data="categories")],
    ])


@sync_to_async

def is_favorite(telegram_user_id, product_id):
    return Favorite.objects.filter(
        customer__telegram_user_id=telegram_user_id,
        product_id=product_id,
    ).exists()


async def send_product_card(message, product, telegram_user_id):
    if not message:
        return

    favorite = await is_favorite(telegram_user_id, product.id)
    text = (
        f"🍬 {product.name}\n\n"
        f"{product.description or 'No description available.'}\n\n"
        f"💰 Price: ₹{product.price}\n"
        f"📦 Stock: {product.stock}\n"
        f"{'🟢 Available' if product.available and product.stock > 0 else '🔴 Out of Stock'}"
    )

    keyboard = product_keyboard(product.id, favorite)

    try:
        if product.image:
            await message.reply_photo(
                photo=product.image.url,
                caption=text,
                reply_markup=keyboard,
            )
            return
    except Exception:
        logger.exception("Product image failed: product_id=%s", product.id)

    await message.reply_text(text, reply_markup=keyboard)


async def show_category_products(update, category_id):
    products = await get_category_products(category_id)
    message = update.effective_message
    if not message:
        return

    if not products:
        await message.reply_text("❌ इस category में अभी कोई product उपलब्ध नहीं है।")
        return

    user = update.effective_user
    await message.reply_text("🛍 Available Products:")

    for product in products:
        await send_product_card(message, product, user.id)


async def show_product_details(update, product_id):
    product = await get_product(product_id)
    if not product:
        await update.effective_message.reply_text("❌ Product नहीं मिला।")
        return
    await send_product_card(
        update.effective_message,
        product,
        update.effective_user.id,
    )


# ============================================================
# CART
# ============================================================


@sync_to_async

def add_product_to_cart(telegram_user_id, product_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    product = Product.objects.filter(id=product_id).first()

    if not product:
        return False, "not_found", 0
    if not product.available:
        return False, "unavailable", 0
    if product.stock <= 0:
        return False, "out_of_stock", 0

    cart, _ = Cart.objects.get_or_create(customer=customer)

    item, created = CartItem.objects.get_or_create(
        cart=cart,
        product=product,
        defaults={
            "quantity": 1,
            "price": product.price,
        },
    )

    if not created:
        if item.quantity >= product.stock:
            return False, "stock_limit", item.quantity
        item.quantity += 1
        item.price = product.price
        item.save()

    return True, "added", item.quantity


@sync_to_async

def get_cart(telegram_user_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    cart, _ = Cart.objects.get_or_create(customer=customer)
    items = list(cart.items.select_related("product").all())
    return cart, items


@sync_to_async

def clear_cart(telegram_user_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    CartItem.objects.filter(cart__customer=customer).delete()


async def show_cart(update):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    cart, items = await get_cart(user.id)

    if not items:
        await message.reply_text("🛒 आपकी Cart अभी खाली है।")
        return

    lines = ["🛒 आपकी Cart\n"]
    total = 0

    for item in items:
        subtotal = item.price * item.quantity
        total += subtotal
        lines.append(
            f"• {item.product.name}\n"
            f"  {item.quantity} × ₹{item.price} = ₹{subtotal}"
        )

    lines.append(f"\n💰 Subtotal: ₹{total}")

    await message.reply_text(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🛍️ Continue Shopping", callback_data="categories")],
            [InlineKeyboardButton("🧹 Clear Cart", callback_data="clear_cart")],
            [InlineKeyboardButton("💳 Checkout", callback_data="checkout")],
        ]),
    )


# ============================================================
# FAVORITES
# ============================================================


@sync_to_async

def toggle_favorite(telegram_user_id, product_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    product = Product.objects.filter(id=product_id).first()
    if not product:
        return False, "not_found"

    favorite = Favorite.objects.filter(
        customer=customer,
        product=product,
    ).first()

    if favorite:
        favorite.delete()
        return False, "removed"

    Favorite.objects.create(customer=customer, product=product)
    return True, "added"


@sync_to_async

def get_favorite_products(telegram_user_id):
    return list(
        Favorite.objects.filter(
            customer__telegram_user_id=telegram_user_id
        ).select_related("product")
    )


async def show_favorites(update):
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    favorites = await get_favorite_products(user.id)
    active = [f.product for f in favorites if f.product.available]

    if not active:
        await message.reply_text("❤️ अभी आपकी Favorites खाली हैं।")
        return

    await message.reply_text(f"❤️ आपके {len(active)} favorite product(s):")
    for product in active:
        await send_product_card(message, product, user.id)


# ============================================================
# SEARCH
# ============================================================


@sync_to_async

def search_products(search_text):
    return list(
        Product.objects.filter(
            available=True,
            stock__gt=0,
            name__icontains=search_text,
        ).order_by("name")[:20]
    )


async def show_search_results(update, search_text):
    products = await search_products(search_text)
    message = update.effective_message
    if not message:
        return

    if not products:
        await message.reply_text(f"🔎 '{search_text}' के लिए कोई product नहीं मिला।")
        return

    await message.reply_text(f"🔎 Search Results: {search_text}")
    for product in products:
        await send_product_card(message, product, update.effective_user.id)


# ============================================================
# ORDERS
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
        await message.reply_text("📦 अभी आपका कोई order नहीं है।")
        return

    for order in orders[:10]:
        await message.reply_text(
            f"📦 Order #{order.order_id}\n"
            f"📌 Status: {order.get_order_status_display()}\n"
            f"💰 Total: ₹{order.total_amount}\n"
            f"🗓 {order.created_at:%d-%m-%Y %H:%M}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📋 Details", callback_data=f"order_{order.order_id}")],
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
        f"📦 Order #{order.order_id}",
        "",
        f"📌 Status: {order.get_order_status_display()}",
        f"💳 Payment: {order.get_payment_method_display()}",
        f"📍 Address: {order.address}",
        "",
        "🛍 Items:",
    ]

    for item in items:
        lines.append(f"• {item.product_name} × {item.quantity} = ₹{item.subtotal}")

    lines.extend([
        "",
        f"💰 Total: ₹{order.total_amount}",
    ])

    await message.reply_text(
        "\n".join(lines),
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

    lines = [f"📦 Order Tracking\n\n🆔 {order.order_id}", ""]
    for _, label in tracking["steps"]:
        lines.append(label)

    await message.reply_text(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⬅️ My Orders", callback_data="orders")],
            [InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu")],
        ]),
    )


# ============================================================
# CHECKOUT
# ============================================================


@sync_to_async

def get_default_address(telegram_user_id):
    from customers.models import CustomerAddress
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)
    return CustomerAddress.objects.filter(
        customer=customer,
        is_default=True,
    ).first()


async def checkout(update):
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
            "📍 Checkout के लिए पहले एक default delivery address save करें।\n\n"
            "अभी backend में address model connected है; next step में Telegram address form जोड़ेंगे।"
        )
        return

    await message.reply_text(
        "💳 Checkout\n\n"
        f"📍 {address.address}, {address.city} - {address.pincode}\n\n"
        "Payment method चुनें:",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("💵 Cash on Delivery", callback_data=f"cod_{address.id}")],
            [InlineKeyboardButton("💳 Razorpay Online", callback_data="online_payment")],
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

        logger.info("CALLBACK RECEIVED: %s from user=%s", data, user.id if user else None)

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

        if data.startswith("addcart_"):
            ok, reason, quantity = await add_product_to_cart(
                user.id,
                int(data.split("_", 1)[1]),
            )
            messages = {
                "added": f"✅ Cart में add हो गया। Quantity: {quantity}",
                "unavailable": "❌ यह product अभी available नहीं है।",
                "out_of_stock": "❌ यह product out of stock है।",
                "stock_limit": f"⚠️ Maximum available quantity पहले ही Cart में है: {quantity}",
                "not_found": "❌ Product नहीं मिला।",
            }
            await query.message.reply_text(messages.get(reason, "❌ Cart update failed."))
            return

        if data == "cart":
            await show_cart(update)
            return

        if data == "clear_cart":
            await clear_cart(user.id)
            await query.message.reply_text("🧹 Cart successfully cleared.")
            return

        if data.startswith("favorite_"):
            added, reason = await toggle_favorite(
                user.id,
                int(data.split("_", 1)[1]),
            )
            if reason == "added":
                await query.message.reply_text("❤️ Product Favorites में add हो गया।")
            elif reason == "removed":
                await query.message.reply_text("💔 Product Favorites से remove हो गया।")
            else:
                await query.message.reply_text("❌ Product नहीं मिला।")
            return

        if data.startswith("details_"):
            await show_product_details(update, int(data.split("_", 1)[1]))
            return

        if data == "checkout":
            await checkout(update)
            return

        if data == "online_payment":
            await query.message.reply_text(
                "💳 Razorpay online payment selected.\n\n"
                "Payment gateway backend connected है; payment order/verification flow अगला step है।"
            )
            return

        if data.startswith("cod_"):
            await query.message.reply_text(
                "💵 COD selected.\n\n"
                "Order creation flow address और stock validation के साथ अगले step में execute किया जाएगा।"
            )
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

        await query.message.reply_text("❌ Unknown button. /start चलाएँ।")

    except Exception:
        logger.exception("CALLBACK HANDLER FAILED.")
        try:
            await query.message.reply_text(
                "❌ Button process करते समय backend error आया। Please try again."
            )
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

    logger.info("TEXT RECEIVED: %s", text)

    if context.user_data.get("search_mode"):
        context.user_data["search_mode"] = False
        await show_search_results(update, text)
        return

    if text in ["🛍 दुकान देखें", "🛍 Shop"]:
        await show_categories(update)
        return

    if text == "🔎 Search":
        context.user_data["search_mode"] = True
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
        await update.message.reply_text(
            "🌐 भाषा चुनें:",
            reply_markup=language_keyboard(),
        )
        return

    if text == "☎️ Help":
        await update.message.reply_text(
            "☎️ Help\n\n"
            "🛍 Shop - Products\n"
            "🔎 Search - Search products\n"
            "🛒 Cart - Cart\n"
            "❤️ Favorites - Saved products\n"
            "📦 My Orders - Orders and tracking\n"
            "📍 Address - Delivery address\n\n"
            "Please contact the shop for support."
        )
        return

    if text in ["📍 मेरा Address", "📍 My Address"]:
        await update.message.reply_text(
            "📍 Address management\n\n"
            "Your delivery addresses are stored in the Django backend."
        )
        return

    await update.message.reply_text(
        "Please menu से कोई option चुनें या /start चलाएँ।"
    )


# ============================================================
# ERROR / HANDLERS
# ============================================================


async def error_handler(update, context):
    logger.error("Telegram update error", exc_info=context.error)


def register_handlers(application):
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(callback_handler))
    application.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler)
    )
    application.add_error_handler(error_handler)
    logger.info("Telegram handlers registered.")
