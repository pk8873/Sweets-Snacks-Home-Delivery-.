import logging

from asgiref.sync import sync_to_async
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

from cart.models import CartItem
from customers.models import Customer
from orders.services import (
    get_order_details,
    get_customer_orders,
)
from products.models import Category, Favorite, Product


logger = logging.getLogger(__name__)

_application = None
_application_initialized = False


# ============================================================
# TELEGRAM APPLICATION
# ============================================================

def get_telegram_application():
    global _application

    if _application is None:

        token = getattr(
            settings,
            "TELEGRAM_BOT_TOKEN",
            "",
        ).strip()

        if not token:
            raise RuntimeError(
                "TELEGRAM_BOT_TOKEN is not configured."
            )

        _application = (
            Application.builder()
            .token(token)
            .updater(None)
            .build()
        )

        register_handlers(_application)

        logger.info(
            "Telegram application created successfully."
        )

    return _application


async def initialize_telegram_application():
    global _application_initialized

    application = get_telegram_application()

    if not _application_initialized:

        await application.initialize()

        _application_initialized = True

        logger.info(
            "Telegram application initialized successfully."
        )

    return application


# ============================================================
# CUSTOMER
# ============================================================

@sync_to_async
def get_or_create_customer(telegram_user):

    customer, created = Customer.objects.get_or_create(
        telegram_id=str(telegram_user.id),
        defaults={
            "name": (
                telegram_user.full_name
                or telegram_user.username
                or "Customer"
            ),
            "language": "en",
        },
    )

    if not customer.name:

        customer.name = (
            telegram_user.full_name
            or telegram_user.username
            or "Customer"
        )

        customer.save(
            update_fields=["name"]
        )

    return customer


@sync_to_async
def get_customer(telegram_user):

    return Customer.objects.filter(
        telegram_id=str(telegram_user.id)
    ).first()


@sync_to_async
def update_customer_language(
    customer,
    language,
):

    customer.language = language

    customer.save(
        update_fields=["language"]
    )

    return customer


# ============================================================
# LANGUAGE
# ============================================================

def language_keyboard():

    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "🇮🇳 हिंदी",
                    callback_data="language_hi",
                ),
                InlineKeyboardButton(
                    "🇬🇧 English",
                    callback_data="language_en",
                ),
            ]
        ]
    )


async def send_language_selection(update):

    text = (
        "🙏 Welcome to Sweet Snacks Home Delivery!\n\n"
        "Please select your language:"
    )

    if update.message:

        await update.message.reply_text(
            text,
            reply_markup=language_keyboard(),
        )

    elif (
        update.callback_query
        and update.callback_query.message
    ):

        await update.callback_query.message.reply_text(
            text,
            reply_markup=language_keyboard(),
        )


# ============================================================
# MENUS
# ============================================================

def hindi_menu():

    return ReplyKeyboardMarkup(
        [
            [
                "🛍️ मिठाई / Snacks",
                "🔎 Search",
            ],
            [
                "🛒 Cart",
                "❤️ Favorites",
            ],
            [
                "📦 My Orders",
                "📍 Address",
            ],
            [
                "🌐 English",
                "❓ Help",
            ],
        ],
        resize_keyboard=True,
    )


def english_menu():

    return ReplyKeyboardMarkup(
        [
            [
                "🛍️ Shop",
                "🔎 Search",
            ],
            [
                "🛒 Cart",
                "❤️ Favorites",
            ],
            [
                "📦 My Orders",
                "📍 Address",
            ],
            [
                "🌐 हिंदी",
                "❓ Help",
            ],
        ],
        resize_keyboard=True,
    )


async def send_hindi_menu(update):

    text = (
        "🙏 स्वागत है!\n\n"
        "🍬 Sweet Snacks Home Delivery\n\n"
        "नीचे दिए गए विकल्प में से चुनें:"
    )

    if update.message:

        await update.message.reply_text(
            text,
            reply_markup=hindi_menu(),
        )

    elif (
        update.callback_query
        and update.callback_query.message
    ):

        await update.callback_query.message.reply_text(
            text,
            reply_markup=hindi_menu(),
        )


async def send_english_menu(update):

    text = (
        "🙏 Welcome!\n\n"
        "🍬 Sweet Snacks Home Delivery\n\n"
        "Please choose an option:"
    )

    if update.message:

        await update.message.reply_text(
            text,
            reply_markup=english_menu(),
        )

    elif (
        update.callback_query
        and update.callback_query.message
    ):

        await update.callback_query.message.reply_text(
            text,
            reply_markup=english_menu(),
        )


# ============================================================
# START
# ============================================================

async def start(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
):

    if not update.effective_user:
        return

    logger.info(
        "Telegram /start received from user=%s",
        update.effective_user.id,
    )

    customer = await get_or_create_customer(
        update.effective_user
    )

    if not customer.language:

        await send_language_selection(
            update
        )

        return

    if customer.language == "hi":

        await send_hindi_menu(
            update
        )

    else:

        await send_english_menu(
            update
        )


# ============================================================
# CATEGORIES
# ============================================================

@sync_to_async
def get_categories():

    return list(
        Category.objects.filter(
            is_active=True
        ).order_by("name")
    )


def category_keyboard(categories):

    buttons = []

    for category in categories:

        buttons.append(
            [
                InlineKeyboardButton(
                    category.name,
                    callback_data=(
                        f"category_{category.id}"
                    ),
                )
            ]
        )

    buttons.append(
        [
            InlineKeyboardButton(
                "🏠 Main Menu",
                callback_data="main_menu",
            )
        ]
    )

    return InlineKeyboardMarkup(
        buttons
    )


async def show_categories(update):

    categories = await get_categories()

    if not categories:

        text = (
            "❌ No categories available right now."
        )

        if update.effective_message:

            await update.effective_message.reply_text(
                text
            )

        return

    keyboard = category_keyboard(
        categories
    )

    text = (
        "🛍️ Please select a category:"
    )

    if update.effective_message:

        await update.effective_message.reply_text(
            text,
            reply_markup=keyboard,
        )


# ============================================================
# PRODUCTS
# ============================================================

@sync_to_async
def get_products_by_category(
    category_id
):

    return list(
        Product.objects.filter(
            category_id=category_id,
            is_active=True,
        ).order_by("name")
    )


@sync_to_async
def get_product(product_id):

    return (
        Product.objects.filter(
            id=product_id,
            is_active=True,
        )
        .select_related("category")
        .first()
    )


def product_keyboard(product):

    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "🛒 Add to Cart",
                    callback_data=(
                        f"addcart_{product.id}"
                    ),
                )
            ],
            [
                InlineKeyboardButton(
                    "❤️ Favorite",
                    callback_data=(
                        f"favorite_{product.id}"
                    ),
                )
            ],
            [
                InlineKeyboardButton(
                    "ℹ️ Details",
                    callback_data=(
                        f"details_{product.id}"
                    ),
                )
            ],
            [
                InlineKeyboardButton(
                    "⬅️ Categories",
                    callback_data="categories",
                )
            ],
        ]
    )


async def send_product_card(
    update,
    product,
):

    text = (
        f"🍬 {product.name}\n\n"
        f"💰 Price: ₹{product.price}\n"
    )

    if getattr(
        product,
        "description",
        None,
    ):

        text += (
            f"\n📝 {product.description}\n"
        )

    if getattr(
        product,
        "stock",
        None,
    ) is not None:

        text += (
            f"\n📦 Stock: {product.stock}"
        )

    keyboard = product_keyboard(
        product
    )

    target = update.effective_message

    if not target:
        return

    try:

        image_field = getattr(
            product,
            "image",
            None,
        )

        if image_field:

            try:

                image_url = image_field.url

            except Exception:

                image_url = None

            if image_url:

                await target.reply_photo(
                    photo=image_url,
                    caption=text,
                    reply_markup=keyboard,
                )

                return

    except Exception:

        logger.exception(
            "Could not send product image. product_id=%s",
            product.id,
        )

    await target.reply_text(
        text,
        reply_markup=keyboard,
    )


async def show_category_products(
    update,
    category_id,
):

    products = await get_products_by_category(
        category_id
    )

    if not products:

        if update.effective_message:

            await update.effective_message.reply_text(
                "❌ No products found in this category."
            )

        return

    for product in products:

        await send_product_card(
            update,
            product,
        )


async def show_product_details(
    update,
    product_id,
):

    product = await get_product(
        product_id
    )

    if not product:

        if update.effective_message:

            await update.effective_message.reply_text(
                "❌ Product not found."
            )

        return

    await send_product_card(
        update,
        product,
    )


# ============================================================
# CART
# ============================================================

@sync_to_async
def add_product_to_cart(
    customer_id,
    product_id,
    quantity=1,
):

    from django.db import transaction

    with transaction.atomic():

        item, created = (
            CartItem.objects
            .select_for_update()
            .get_or_create(
                customer_id=customer_id,
                product_id=product_id,
                defaults={
                    "quantity": quantity,
                },
            )
        )

        if not created:

            item.quantity += quantity

            item.save(
                update_fields=[
                    "quantity"
                ]
            )

    return item


@sync_to_async
def get_cart_items(
    customer_id
):

    return list(
        CartItem.objects.filter(
            customer_id=customer_id
        )
        .select_related("product")
    )


@sync_to_async
def clear_cart(
    customer_id
):

    CartItem.objects.filter(
        customer_id=customer_id
    ).delete()


def cart_keyboard():

    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "🛍️ Continue Shopping",
                    callback_data="categories",
                )
            ],
            [
                InlineKeyboardButton(
                    "🧹 Clear Cart",
                    callback_data="clear_cart",
                )
            ],
            [
                InlineKeyboardButton(
                    "💳 Checkout",
                    callback_data="checkout",
                )
            ],
        ]
    )


async def show_cart(update):

    customer = await get_customer(
        update.effective_user
    )

    if not customer:

        await update.effective_message.reply_text(
            "❌ Customer account not found. "
            "Please use /start."
        )

        return

    items = await get_cart_items(
        customer.id
    )

    if not items:

        await update.effective_message.reply_text(
            "🛒 Your cart is empty."
        )

        return

    total = 0

    lines = [
        "🛒 Your Cart\n"
    ]

    for item in items:

        subtotal = (
            item.product.price
            * item.quantity
        )

        total += subtotal

        lines.append(
            f"• {item.product.name}\n"
            f"  Qty: {item.quantity}\n"
            f"  ₹{subtotal}"
        )

    lines.append(
        f"\n💰 Total: ₹{total}"
    )

    await update.effective_message.reply_text(
        "\n".join(lines),
        reply_markup=cart_keyboard(),
    )


# ============================================================
# FAVORITES
# ============================================================

@sync_to_async
def add_favorite(
    customer_id,
    product_id,
):

    Favorite.objects.get_or_create(
        customer_id=customer_id,
        product_id=product_id,
    )


@sync_to_async
def get_favorites(
    customer_id
):

    return list(
        Favorite.objects.filter(
            customer_id=customer_id
        )
        .select_related("product")
    )


async def show_favorites(update):

    customer = await get_customer(
        update.effective_user
    )

    if not customer:

        await update.effective_message.reply_text(
            "❌ Customer account not found."
        )

        return

    favorites = await get_favorites(
        customer.id
    )

    if not favorites:

        await update.effective_message.reply_text(
            "❤️ You don't have any "
            "favorite products yet."
        )

        return

    await update.effective_message.reply_text(
        "❤️ Your Favorite Products:"
    )

    for favorite in favorites:

        product = favorite.product

        if product.is_active:

            await send_product_card(
                update,
                product,
            )


# ============================================================
# SEARCH
# ============================================================

@sync_to_async
def search_products(
    search_text
):

    return list(
        Product.objects.filter(
            is_active=True,
            name__icontains=search_text,
        )
        .order_by("name")[:20]
    )


async def show_search_results(
    update,
    search_text,
):

    products = await search_products(
        search_text
    )

    if not products:

        await update.effective_message.reply_text(
            "❌ No products found.\n\n"
            "Try another product name."
        )

        return

    await update.effective_message.reply_text(
        f"🔎 Search results for: "
        f"{search_text}"
    )

    for product in products:

        await send_product_card(
            update,
            product,
        )


async def start_search(
    update,
    context,
):

    context.user_data[
        "search_mode"
    ] = True

    await update.effective_message.reply_text(
        "🔎 Please type the product name "
        "you want to search."
    )


# ============================================================
# ORDERS
# ============================================================

@sync_to_async
def get_orders_for_customer(
    customer_id
):

    return list(
        get_customer_orders(
            customer_id
        )
    )


async def show_orders(update):

    customer = await get_customer(
        update.effective_user
    )

    if not customer:

        await update.effective_message.reply_text(
            "❌ Customer account not found."
        )

        return

    orders = await get_orders_for_customer(
        customer.id
    )

    if not orders:

        await update.effective_message.reply_text(
            "📦 You don't have any orders yet."
        )

        return

    for order in orders:

        order_id = getattr(
            order,
            "order_id",
            getattr(
                order,
                "id",
                "N/A",
            ),
        )

        status = getattr(
            order,
            "status",
            "Unknown",
        )

        total = getattr(
            order,
            "total_amount",
            getattr(
                order,
                "total",
                0,
            ),
        )

        keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "📋 Details",
                        callback_data=(
                            f"order_{order.id}"
                        ),
                    )
                ]
            ]
        )

        await update.effective_message.reply_text(
            f"📦 Order: #{order_id}\n"
            f"📌 Status: {status}\n"
            f"💰 Total: ₹{total}",
            reply_markup=keyboard,
        )


@sync_to_async
def get_order_for_customer(
    order_id,
    customer_id,
):

    try:

        return get_order_details(
            order_id,
            customer_id,
        )

    except Exception:

        logger.exception(
            "Error getting order details."
        )

        return None


async def show_order_details(
    update,
    order_id,
):

    customer = await get_customer(
        update.effective_user
    )

    if not customer:

        await update.effective_message.reply_text(
            "❌ Customer account not found."
        )

        return

    order = await get_order_for_customer(
        order_id,
        customer.id,
    )

    if not order:

        await update.effective_message.reply_text(
            "❌ Order not found."
        )

        return

    if isinstance(
        order,
        dict,
    ):

        order_id_display = order.get(
            "order_id",
            order_id,
        )

        status = order.get(
            "status",
            "Unknown",
        )

        total = order.get(
            "total_amount",
            order.get(
                "total",
                0,
            ),
        )

    else:

        order_id_display = getattr(
            order,
            "order_id",
            order_id,
        )

        status = getattr(
            order,
            "status",
            "Unknown",
        )

        total = getattr(
            order,
            "total_amount",
            getattr(
                order,
                "total",
                0,
            ),
        )

    await update.effective_message.reply_text(
        f"📦 Order #{order_id_display}\n\n"
        f"📌 Status: {status}\n"
        f"💰 Total: ₹{total}"
    )


# ============================================================
# CALLBACK HANDLER
# ============================================================

async def callback_handler(
    update,
    context,
):

    query = update.callback_query

    if not query:
        return

    try:

        await query.answer()

        data = query.data or ""

        logger.info(
            "Telegram callback received: %s",
            data,
        )

        # ----------------------------------------------------
        # LANGUAGE
        # ----------------------------------------------------

        if data == "language_hi":

            customer = await get_customer(
                update.effective_user
            )

            if customer:

                await update_customer_language(
                    customer,
                    "hi",
                )

            await send_hindi_menu(
                update
            )

            return

        if data == "language_en":

            customer = await get_customer(
                update.effective_user
            )

            if customer:

                await update_customer_language(
                    customer,
                    "en",
                )

            await send_english_menu(
                update
            )

            return

        # ----------------------------------------------------
        # MAIN MENU
        # ----------------------------------------------------

        if data == "main_menu":

            customer = await get_customer(
                update.effective_user
            )

            if (
                customer
                and customer.language == "hi"
            ):

                await send_hindi_menu(
                    update
                )

            else:

                await send_english_menu(
                    update
                )

            return

        # ----------------------------------------------------
        # CATEGORIES
        # ----------------------------------------------------

        if data == "categories":

            await show_categories(
                update
            )

            return

        # ----------------------------------------------------
        # CATEGORY
        # ----------------------------------------------------

        if data.startswith(
            "category_"
        ):

            category_id = int(
                data.split(
                    "_",
                    1,
                )[1]
            )

            await show_category_products(
                update,
                category_id,
            )

            return

        # ----------------------------------------------------
        # ADD CART
        # ----------------------------------------------------

        if data.startswith(
            "addcart_"
        ):

            product_id = int(
                data.split(
                    "_",
                    1,
                )[1]
            )

            customer = await get_customer(
                update.effective_user
            )

            if not customer:

                await query.message.reply_text(
                    "❌ Customer account not found."
                )

                return

            product = await get_product(
                product_id
            )

            if not product:

                await query.message.reply_text(
                    "❌ Product not found."
                )

                return

            await add_product_to_cart(
                customer.id,
                product.id,
                1,
            )

            await query.message.reply_text(
                f"✅ {product.name} "
                f"added to cart."
            )

            return

        # ----------------------------------------------------
        # FAVORITE
        # ----------------------------------------------------

        if data.startswith(
            "favorite_"
        ):

            product_id = int(
                data.split(
                    "_",
                    1,
                )[1]
            )

            customer = await get_customer(
                update.effective_user
            )

            product = await get_product(
                product_id
            )

            if not customer or not product:

                await query.message.reply_text(
                    "❌ Product not found."
                )

                return

            await add_favorite(
                customer.id,
                product.id,
            )

            await query.message.reply_text(
                f"❤️ {product.name} "
                f"added to favorites."
            )

            return

        # ----------------------------------------------------
        # DETAILS
        # ----------------------------------------------------

        if data.startswith(
            "details_"
        ):

            product_id = int(
                data.split(
                    "_",
                    1,
                )[1]
            )

            await show_product_details(
                update,
                product_id,
            )

            return

        # ----------------------------------------------------
        # CART
        # ----------------------------------------------------

        if data == "cart":

            await show_cart(
                update
            )

            return

        # ----------------------------------------------------
        # CLEAR CART
        # ----------------------------------------------------

        if data == "clear_cart":

            customer = await get_customer(
                update.effective_user
            )

            if customer:

                await clear_cart(
                    customer.id
                )

            await query.message.reply_text(
                "🧹 Cart cleared successfully."
            )

            return

        # ----------------------------------------------------
        # CHECKOUT
        # ----------------------------------------------------

        if data == "checkout":

            await query.message.reply_text(
                "💳 Checkout module will handle:\n\n"
                "📍 Delivery Address\n"
                "🚚 Delivery Charges\n"
                "💵 Cash on Delivery\n"
                "💳 Razorpay Online Payment"
            )

            return

        # ----------------------------------------------------
        # ORDERS
        # ----------------------------------------------------

        if data == "orders":

            await show_orders(
                update
            )

            return

        # ----------------------------------------------------
        # ORDER DETAILS
        # ----------------------------------------------------

        if data.startswith(
            "order_"
        ):

            order_id = int(
                data.split(
                    "_",
                    1,
                )[1]
            )

            await show_order_details(
                update,
                order_id,
            )

            return

        await query.message.reply_text(
            "❌ Unknown option. "
            "Please use /start."
        )

    except (
        ValueError,
        TypeError,
    ):

        logger.exception(
            "Invalid Telegram callback: %s",
            query.data if query else None,
        )

        if query.message:

            await query.message.reply_text(
                "❌ Invalid request."
            )

    except Exception:

        logger.exception(
            "Telegram callback error."
        )

        if query.message:

            await query.message.reply_text(
                "❌ Something went wrong. "
                "Please try again."
            )


# ============================================================
# TEXT HANDLER
# ============================================================

async def text_handler(
    update,
    context,
):

    if not update.message:
        return

    text = (
        update.message.text or ""
    ).strip()

    if not text:
        return

    logger.info(
        "Telegram text received: %s",
        text,
    )

    # --------------------------------------------------------
    # SEARCH MODE
    # --------------------------------------------------------

    if context.user_data.get(
        "search_mode"
    ):

        context.user_data[
            "search_mode"
        ] = False

        await show_search_results(
            update,
            text,
        )

        return

    # --------------------------------------------------------
    # SHOP
    # --------------------------------------------------------

    if text in [
        "🛍️ Shop",
        "🛍️ मिठाई / Snacks",
    ]:

        await show_categories(
            update
        )

        return

    # --------------------------------------------------------
    # SEARCH
    # --------------------------------------------------------

    if text == "🔎 Search":

        await start_search(
            update,
            context,
        )

        return

    # --------------------------------------------------------
    # FAVORITES
    # --------------------------------------------------------

    if text == "❤️ Favorites":

        await show_favorites(
            update
        )

        return

    # --------------------------------------------------------
    # CART
    # --------------------------------------------------------

    if text == "🛒 Cart":

        await show_cart(
            update
        )

        return

    # --------------------------------------------------------
    # ORDERS
    # --------------------------------------------------------

    if text == "📦 My Orders":

        await show_orders(
            update
        )

        return

    # --------------------------------------------------------
    # HINDI
    # --------------------------------------------------------

    if text == "🌐 हिंदी":

        customer = await get_customer(
            update.effective_user
        )

        if customer:

            await update_customer_language(
                customer,
                "hi",
            )

        await send_hindi_menu(
            update
        )

        return

    # --------------------------------------------------------
    # ENGLISH
    # --------------------------------------------------------

    if text == "🌐 English":

        customer = await get_customer(
            update.effective_user
        )

        if customer:

            await update_customer_language(
                customer,
                "en",
            )

        await send_english_menu(
            update
        )

        return

    # --------------------------------------------------------
    # ADDRESS
    # --------------------------------------------------------

    if text == "📍 Address":

        await update.message.reply_text(
            "📍 Address management will be "
            "available during checkout."
        )

        return

    # --------------------------------------------------------
    # HELP
    # --------------------------------------------------------

    if text == "❓ Help":

        await update.message.reply_text(
            "❓ Help\n\n"
            "🛍️ Shop - Browse products\n"
            "🔎 Search - Search products\n"
            "🛒 Cart - View cart\n"
            "❤️ Favorites - Saved products\n"
            "📦 My Orders - View orders\n"
            "📍 Address - Delivery address\n\n"
            "For support, please contact the shop."
        )

        return

    await update.message.reply_text(
        "Please select an option from "
        "the menu.\n\n"
        "Or use /start."
    )


# ============================================================
# ERROR HANDLER
# ============================================================

async def error_handler(
    update,
    context,
):

    logger.error(
        "Telegram update error",
        exc_info=context.error,
    )


# ============================================================
# REGISTER HANDLERS
# ============================================================

def register_handlers(
    application
):

    application.add_handler(
        CommandHandler(
            "start",
            start,
        )
    )

    application.add_handler(
        CallbackQueryHandler(
            callback_handler
        )
    )

    application.add_handler(
        MessageHandler(
            filters.TEXT
            & ~filters.COMMAND,
            text_handler,
        )
    )

    application.add_error_handler(
        error_handler
    )

    logger.info(
        "Telegram handlers registered successfully."
    )