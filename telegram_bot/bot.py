import os

from asgiref.sync import sync_to_async

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
from products.models import (
    Category,
    Favorite,
    Product,
)

from orders.services import (
    get_customer_orders,
    get_order_details,
    reorder_order,
    build_order_tracking,
)


# =========================================================
# CUSTOMER DATABASE FUNCTIONS
# =========================================================

@sync_to_async
def get_or_create_customer(telegram_user):

    customer, created = Customer.objects.get_or_create(
        telegram_user_id=telegram_user.id,
        defaults={
            "telegram_username": telegram_user.username,
            "name": telegram_user.full_name or "Customer",
        },
    )

    if not created:

        customer.telegram_username = telegram_user.username

        if telegram_user.full_name:
            customer.name = telegram_user.full_name

        customer.save(
            update_fields=[
                "telegram_username",
                "name",
                "updated_at",
            ]
        )

    return customer, created


@sync_to_async
def get_customer(telegram_user_id):

    return Customer.objects.get(
        telegram_user_id=telegram_user_id
    )


@sync_to_async
def update_customer_language(
    telegram_user_id,
    language,
):

    customer = Customer.objects.get(
        telegram_user_id=telegram_user_id
    )

    customer.language = language

    customer.save(
        update_fields=[
            "language",
            "updated_at",
        ]
    )

    return customer


# =========================================================
# LANGUAGE KEYBOARD
# =========================================================

def language_keyboard():

    keyboard = [
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

    return InlineKeyboardMarkup(
        keyboard
    )


# =========================================================
# MAIN MENU
# =========================================================

def hindi_menu():

    keyboard = [
        [
            "🛍 दुकान देखें",
            "🛒 मेरी Cart",
        ],
        [
            "📦 मेरे Orders",
            "❤️ Favorites",
        ],
        [
            "🔎 Search",
            "📍 मेरा Address",
        ],
        [
            "☎️ Help",
        ],
        [
            "🌐 Language",
        ],
    ]

    return ReplyKeyboardMarkup(
        keyboard,
        resize_keyboard=True,
        is_persistent=True,
    )


def english_menu():

    keyboard = [
        [
            "🛍 Shop",
            "🛒 My Cart",
        ],
        [
            "📦 My Orders",
            "❤️ Favorites",
        ],
        [
            "🔎 Search",
            "📍 My Address",
        ],
        [
            "☎️ Help",
        ],
        [
            "🌐 Language",
        ],
    ]

    return ReplyKeyboardMarkup(
        keyboard,
        resize_keyboard=True,
        is_persistent=True,
    )


# =========================================================
# LANGUAGE SELECTION
# =========================================================

async def send_language_selection(update):

    await update.message.reply_text(
        "👋 Welcome!\n\n"
        "Please select your language.\n\n"
        "कृपया अपनी भाषा चुनें।",
        reply_markup=language_keyboard(),
    )


# =========================================================
# HOME MENU
# =========================================================

async def send_hindi_menu(
    update,
    customer,
):

    await update.message.reply_text(
        f"🍬 Sweet & Snacks में आपका स्वागत है, "
        f"{customer.name}!\n\n"
        "आज क्या करना चाहते हैं?",
        reply_markup=hindi_menu(),
    )


async def send_english_menu(
    update,
    customer,
):

    await update.message.reply_text(
        f"🍬 Welcome to Sweet & Snacks, "
        f"{customer.name}!\n\n"
        "What would you like to do?",
        reply_markup=english_menu(),
    )


# =========================================================
# START
# =========================================================

async def start(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
):

    telegram_user = update.effective_user

    if telegram_user is None:
        return

    customer, created = await get_or_create_customer(
        telegram_user
    )

    if created:

        await send_language_selection(
            update
        )

        return

    if customer.language == "en":

        await send_english_menu(
            update,
            customer,
        )

    else:

        await send_hindi_menu(
            update,
            customer,
        )


# =========================================================
# CATEGORY DATABASE
# =========================================================

@sync_to_async
def get_categories():

    return list(
        Category.objects.filter(
            active=True
        ).order_by("name")
    )


@sync_to_async
def get_category(category_id):

    try:

        return Category.objects.get(
            id=category_id,
            active=True,
        )

    except Category.DoesNotExist:

        return None


# =========================================================
# PRODUCT DATABASE
# =========================================================

@sync_to_async
def get_category_products(category_id):

    return list(
        Product.objects.filter(
            category_id=category_id,
            available=True,
            stock__gt=0,
        ).select_related(
            "category"
        ).order_by(
            "name"
        )
    )


@sync_to_async
def get_product(product_id):

    try:

        return Product.objects.select_related(
            "category"
        ).get(
            id=product_id
        )

    except Product.DoesNotExist:

        return None


# =========================================================
# SEARCH PRODUCTS
# =========================================================

@sync_to_async
def search_products(search_text):

    return list(
        Product.objects.filter(
            available=True,
            stock__gt=0,
        )
        .filter(
            name__icontains=search_text
        )
        .select_related(
            "category"
        )
        .order_by(
            "name"
        )[:20]
    )


# =========================================================
# FAVORITE DATABASE FUNCTIONS
# =========================================================

@sync_to_async
def toggle_favorite(
    telegram_user_id,
    product_id,
):

    customer = Customer.objects.get(
        telegram_user_id=telegram_user_id
    )

    product = Product.objects.get(
        id=product_id
    )

    favorite = Favorite.objects.filter(
        customer=customer,
        product=product,
    ).first()

    if favorite:

        favorite.delete()

        return False

    Favorite.objects.create(
        customer=customer,
        product=product,
    )

    return True


@sync_to_async
def get_customer_favorites(
    telegram_user_id,
):

    return list(
        Favorite.objects.filter(
            customer__telegram_user_id=telegram_user_id
        )
        .select_related(
            "product",
            "product__category",
        )
        .order_by(
            "-created_at"
        )
    )


# =========================================================
# CHECK FAVORITE
# =========================================================

@sync_to_async
def is_favorite(
    telegram_user_id,
    product_id,
):

    return Favorite.objects.filter(
        customer__telegram_user_id=telegram_user_id,
        product_id=product_id,
    ).exists()


# =========================================================
# CATEGORY KEYBOARD
# =========================================================

def category_keyboard(
    categories,
    language="hi",
):

    emoji_map = {
        "sweets": "🍬",
        "namkeen": "🥨",
        "biscuits": "🍪",
        "chocolates": "🍫",
        "gift packs": "🎁",
        "drinks": "🥤",
    }

    buttons = []

    for category in categories:

        emoji = emoji_map.get(
            category.name.lower(),
            "📂",
        )

        buttons.append(
            [
                InlineKeyboardButton(
                    f"{emoji} {category.name}",
                    callback_data=(
                        f"category_{category.id}"
                    ),
                )
            ]
        )

    if language == "en":

        buttons.append(
            [
                InlineKeyboardButton(
                    "🏠 Main Menu",
                    callback_data="main_menu",
                )
            ]
        )

    else:

        buttons.append(
            [
                InlineKeyboardButton(
                    "🏠 मुख्य Menu",
                    callback_data="main_menu",
                )
            ]
        )

    return InlineKeyboardMarkup(
        buttons
    )


# =========================================================
# PRODUCT KEYBOARD
# =========================================================

def product_keyboard(
    product_id,
    language="hi",
    favorite=False,
):

    if language == "en":

        favorite_text = (
            "💔 Remove Favorite"
            if favorite
            else
            "❤️ Add to Favorites"
        )

        return InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "➕ Add to Cart",
                        callback_data=(
                            f"addcart_{product_id}"
                        ),
                    )
                ],
                [
                    InlineKeyboardButton(
                        favorite_text,
                        callback_data=(
                            f"favorite_{product_id}"
                        ),
                    ),
                    InlineKeyboardButton(
                        "📖 Details",
                        callback_data=(
                            f"details_{product_id}"
                        ),
                    ),
                ],
                [
                    InlineKeyboardButton(
                        "⬅️ Categories",
                        callback_data="categories",
                    )
                ],
            ]
        )

    favorite_text = (
        "💔 Favorite हटाएँ"
        if favorite
        else
        "❤️ Favorite में डालें"
    )

    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "➕ Cart में डालें",
                    callback_data=(
                        f"addcart_{product_id}"
                    ),
                )
            ],
            [
                InlineKeyboardButton(
                    favorite_text,
                    callback_data=(
                        f"favorite_{product_id}"
                    ),
                ),
                InlineKeyboardButton(
                    "📖 Details",
                    callback_data=(
                        f"details_{product_id}"
                    ),
                ),
            ],
            [
                InlineKeyboardButton(
                    "⬅️ Categories",
                    callback_data="categories",
                )
            ],
        ]
    )


# =========================================================
# PRODUCT CAPTION
# =========================================================

def product_caption(
    product,
    language="hi",
):

    if product.available and product.stock > 0:

        availability = "🟢 Available"

    else:

        availability = "🔴 Out of Stock"

    description = (
        product.description
        if product.description
        else
        (
            "No description available."
            if language == "en"
            else
            "इस product का description उपलब्ध नहीं है।"
        )
    )

    return (
        f"🍬 {product.name}\n\n"
        f"{description}\n\n"
        f"💰 ₹{product.price}\n\n"
        f"{availability}"
    )


# =========================================================
# SEND PRODUCT CARD
# =========================================================

async def send_product_card(
    message,
    product,
    customer,
):

    favorite = await is_favorite(
        customer.telegram_user_id,
        product.id,
    )

    caption = product_caption(
        product,
        customer.language,
    )

    keyboard = product_keyboard(
        product.id,
        customer.language,
        favorite,
    )

    if product.image:

        try:

            image_path = product.image.path

            with open(
                image_path,
                "rb",
            ) as photo:

                await message.reply_photo(
                    photo=photo,
                    caption=caption,
                    reply_markup=keyboard,
                )

            return

        except (
            FileNotFoundError,
            ValueError,
        ):
            pass

    await message.reply_text(
        caption,
        reply_markup=keyboard,
    )


# =========================================================
# SHOW CATEGORIES
# =========================================================

async def show_categories_from_message(
    update,
    customer,
):

    categories = await get_categories()

    if not categories:

        message = (
            "📂 Categories\n\n"
            "No categories are available."
            if customer.language == "en"
            else
            "📂 Categories\n\n"
            "अभी कोई category उपलब्ध नहीं है।"
        )

        await update.message.reply_text(
            message
        )

        return

    if customer.language == "en":

        text = (
            "📂 Categories\n\n"
            "Please select a category:"
        )

    else:

        text = (
            "📂 Categories\n\n"
            "कृपया category चुनें:"
        )

    await update.message.reply_text(
        text,
        reply_markup=category_keyboard(
            categories,
            customer.language,
        ),
    )


# =========================================================
# SHOW PRODUCTS
# =========================================================

async def show_products(
    query,
    category_id,
):

    customer = await get_customer(
        query.from_user.id
    )

    category = await get_category(
        category_id
    )

    if category is None:

        await query.message.reply_text(
            "Category not found."
        )

        return

    products = await get_category_products(
        category_id
    )

    if not products:

        if customer.language == "en":

            text = (
                f"📂 {category.name}\n\n"
                "No products are currently available."
            )

        else:

            text = (
                f"📂 {category.name}\n\n"
                "अभी इस category में कोई product "
                "उपलब्ध नहीं है।"
            )

        await query.message.reply_text(
            text
        )

        return

    if customer.language == "en":

        heading = (
            f"📂 {category.name}\n\n"
            "🛍 Available Products:"
        )

    else:

        heading = (
            f"📂 {category.name}\n\n"
            "🛍 उपलब्ध Products:"
        )

    await query.message.reply_text(
        heading
    )

    for product in products:

        await send_product_card(
            query.message,
            product,
            customer,
        )


# =========================================================
# SEARCH MODE
# =========================================================

async def start_search(
    update,
    customer,
):

    if customer.language == "en":

        text = (
            "🔎 Search Products\n\n"
            "Please type the product name you want "
            "to search for.\n\n"
            "Example:\n"
            "kaju"
        )

    else:

        text = (
            "🔎 Product Search\n\n"
            "जिस product को ढूँढना है उसका नाम type करें।\n\n"
            "Example:\n"
            "kaju"
        )

    await update.message.reply_text(
        text
    )


# =========================================================
# SHOW SEARCH RESULTS
# =========================================================

async def show_search_results(
    update,
    search_text,
):

    customer = await get_customer(
        update.effective_user.id
    )

    products = await search_products(
        search_text
    )

    if not products:

        if customer.language == "en":

            text = (
                f"🔎 Search: {search_text}\n\n"
                "❌ No products found.\n\n"
                "Please try another product name."
            )

        else:

            text = (
                f"🔎 Search: {search_text}\n\n"
                "❌ कोई product नहीं मिला।\n\n"
                "कृपया दूसरा product name try करें।"
            )

        await update.message.reply_text(
            text
        )

        return

    if customer.language == "en":

        text = (
            f"🔎 Search Results for: {search_text}\n\n"
            f"Found {len(products)} product(s)."
        )

    else:

        text = (
            f"🔎 Search Results: {search_text}\n\n"
            f"{len(products)} product(s) मिले।"
        )

    await update.message.reply_text(
        text
    )

    for product in products:

        await send_product_card(
            update.message,
            product,
            customer,
        )


# =========================================================
# SHOW FAVORITES
# =========================================================

async def show_favorites(
    update,
    customer,
):

    favorites = await get_customer_favorites(
        customer.telegram_user_id
    )

    if not favorites:

        if customer.language == "en":

            text = (
                "❤️ My Favorites\n\n"
                "You have no favorite products yet."
            )

        else:

            text = (
                "❤️ Favorites\n\n"
                "अभी आपके कोई favorite products नहीं हैं।"
            )

        await update.message.reply_text(
            text
        )

        return

    if customer.language == "en":

        text = (
            "❤️ My Favorites\n\n"
            f"You have {len(favorites)} favorite product(s)."
        )

    else:

        text = (
            "❤️ Favorites\n\n"
            f"आपके {len(favorites)} favorite product(s) हैं।"
        )

    await update.message.reply_text(
        text
    )

    for favorite in favorites:

        product = favorite.product

        await send_product_card(
            update.message,
            product,
            customer,
        )


# =========================================================
# ADD TO CART
# =========================================================

@sync_to_async
def add_product_to_cart(
    telegram_user_id,
    product_id,
):

    customer = Customer.objects.get(
        telegram_user_id=telegram_user_id
    )

    product = Product.objects.get(
        id=product_id
    )

    if not product.available:

        return False, "unavailable"

    if product.stock <= 0:

        return False, "out_of_stock"

    cart, _ = Cart.objects.get_or_create(
        customer=customer
    )

    cart_item, created = CartItem.objects.get_or_create(
        cart=cart,
        product=product,
        defaults={
            "quantity": 1,
            "price": product.price,
        },
    )

    if not created:

        if cart_item.quantity >= product.stock:

            return False, "stock_limit"

        cart_item.quantity += 1
        cart_item.price = product.price
        cart_item.save()

    return True, cart_item.quantity


# =========================================================
# CART VIEW
# =========================================================

@sync_to_async
def get_cart_data(telegram_user_id):
    customer = Customer.objects.get(telegram_user_id=telegram_user_id)

    cart = (
        Cart.objects
        .filter(customer=customer)
        .prefetch_related("items__product")
        .first()
    )

    if not cart:
        return {
            "items": [],
            "subtotal": 0,
            "total_items": 0,
        }

    items = []
    for item in cart.items.all():
        items.append({
            "product_name": item.product.name,
            "quantity": item.quantity,
            "price": item.price,
            "subtotal": item.subtotal,
        })

    return {
        "items": items,
        "subtotal": cart.subtotal,
        "total_items": cart.total_items,
    }


def cart_keyboard(language="hi"):
    if language == "en":
        return InlineKeyboardMarkup([
            [
                InlineKeyboardButton("🛒 Checkout", callback_data="checkout"),
            ],
            [
                InlineKeyboardButton("🛍 Continue Shopping", callback_data="categories"),
            ],
            [
                InlineKeyboardButton("🏠 Main Menu", callback_data="main_menu"),
            ],
        ])

    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🛒 Checkout", callback_data="checkout"),
        ],
        [
            InlineKeyboardButton("🛍 Shopping जारी रखें", callback_data="categories"),
        ],
        [
            InlineKeyboardButton("🏠 मुख्य Menu", callback_data="main_menu"),
        ],
    ])


async def show_cart(update, customer):
    cart = await get_cart_data(customer.telegram_user_id)

    if not cart["items"]:
        if customer.language == "en":
            text = (
                "🛒 My Cart\n\n"
                "Your cart is empty.\n\n"
                "Please add some products first."
            )
        else:
            text = (
                "🛒 मेरी Cart\n\n"
                "आपकी Cart अभी खाली है।\n\n"
                "पहले कुछ products Cart में add करें।"
            )

        await update.message.reply_text(text)
        return

    lines = []
    for item in cart["items"]:
        lines.append(
            f"🍬 {item['product_name']}\n"
            f"{item['quantity']} × ₹{item['price']} = ₹{item['subtotal']}"
        )

    if customer.language == "en":
        text = (
            "🛒 MY CART\n\n"
            + "\n\n".join(lines)
            + f"\n\nSubtotal = ₹{cart['subtotal']}"
        )
    else:
        text = (
            "🛒 मेरी CART\n\n"
            + "\n\n".join(lines)
            + f"\n\nSubtotal = ₹{cart['subtotal']}"
        )

    await update.message.reply_text(
        text,
        reply_markup=cart_keyboard(customer.language),
    )


# =========================================================
# CUSTOMER ORDERS
# =========================================================

def order_list_keyboard(orders, language="hi"):
    buttons = []

    for order in orders:
        label = f"📦 {order.order_id} • ₹{order.total_amount}"
        buttons.append([
            InlineKeyboardButton(
                label,
                callback_data=f"order_{order.id}",
            )
        ])

    buttons.append([
        InlineKeyboardButton(
            "🏠 Main Menu" if language == "en" else "🏠 मुख्य Menu",
            callback_data="main_menu",
        )
    ])

    return InlineKeyboardMarkup(buttons)


async def show_orders(update, customer):
    orders = await get_customer_orders(customer.id)

    if not orders:
        if customer.language == "en":
            text = (
                "📦 My Orders\n\n"
                "You have no orders yet."
            )
        else:
            text = (
                "📦 मेरे Orders\n\n"
                "अभी आपका कोई order नहीं है।"
            )

        await update.message.reply_text(text)
        return

    lines = []

    for order in orders[:20]:
        status = order.get_order_status_display()
        lines.append(
            f"#{order.order_id}\n"
            f"₹{order.total_amount}\n"
            f"{status}"
        )

    text = (
        "📦 My Orders\n\n"
        + "\n\n".join(lines)
        if customer.language == "en"
        else
        "📦 मेरे Orders\n\n"
        + "\n\n".join(lines)
    )

    await update.message.reply_text(
        text,
        reply_markup=order_list_keyboard(
            orders[:20],
            customer.language,
        ),
    )


async def show_order_details(query, order_id):
    customer = await get_customer(query.from_user.id)
    order = await get_order_details(customer.id, order_id)

    if not order:
        message = (
            "❌ Order not found."
            if customer.language == "en"
            else
            "❌ Order नहीं मिला।"
        )
        await query.message.reply_text(message)
        return

    item_lines = []

    for item in order.items.all():
        item_lines.append(
            f"🍬 {item.product_name} × {item.quantity}"
        )

    if customer.language == "en":
        text = (
            "📦 Order Details\n\n"
            f"🆔 {order.order_id}\n\n"
            + "\n".join(item_lines)
            + f"\n\nTotal: ₹{order.total_amount}\n"
            f"💳 Payment: {order.get_payment_method_display()}\n"
            f"📌 Status: {order.get_order_status_display()}"
        )
        buttons = [
            [
                InlineKeyboardButton(
                    "🔄 Reorder",
                    callback_data=f"reorder_{order.id}",
                ),
                InlineKeyboardButton(
                    "📦 Track",
                    callback_data=f"track_{order.id}",
                ),
            ],
            [
                InlineKeyboardButton(
                    "⬅️ My Orders",
                    callback_data="orders",
                )
            ],
        ]
    else:
        text = (
            "📦 Order Details\n\n"
            f"🆔 {order.order_id}\n\n"
            + "\n".join(item_lines)
            + f"\n\nकुल: ₹{order.total_amount}\n"
            f"💳 Payment: {order.get_payment_method_display()}\n"
            f"📌 Status: {order.get_order_status_display()}"
        )
        buttons = [
            [
                InlineKeyboardButton(
                    "🔄 Reorder",
                    callback_data=f"reorder_{order.id}",
                ),
                InlineKeyboardButton(
                    "📦 Track",
                    callback_data=f"track_{order.id}",
                ),
            ],
            [
                InlineKeyboardButton(
                    "⬅️ My Orders",
                    callback_data="orders",
                )
            ],
        ]

    await query.message.reply_text(
        text,
        reply_markup=InlineKeyboardMarkup(buttons),
    )


async def reorder_customer_order(query, order_id):
    customer = await get_customer(query.from_user.id)

    result = await reorder_order(
        customer.id,
        order_id,
    )

    added = result.get("added", [])
    skipped = result.get("skipped", [])

    if customer.language == "en":
        lines = ["🔄 Reorder Result\n"]

        if added:
            lines.append("✅ Added to Cart:")
            for item in added:
                lines.append(
                    f"• {item['product_name']} × {item['quantity']}"
                )

        if skipped:
            lines.append("\n⚠️ Not added:")
            for item in skipped:
                lines.append(
                    f"• {item['product_name']} — {item['reason']}"
                )

        if not added and not skipped:
            lines.append("No items could be reordered.")

        text = "\n".join(lines)

        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton(
                    "🛒 Review Cart",
                    callback_data="cart",
                )
            ],
            [
                InlineKeyboardButton(
                    "📦 My Orders",
                    callback_data="orders",
                )
            ],
        ])
    else:
        lines = ["🔄 Reorder Result\n"]

        if added:
            lines.append("✅ Cart में add हुए:")
            for item in added:
                lines.append(
                    f"• {item['product_name']} × {item['quantity']}"
                )

        if skipped:
            lines.append("\n⚠️ Add नहीं हुए:")
            for item in skipped:
                lines.append(
                    f"• {item['product_name']} — {item['reason']}"
                )

        if not added and not skipped:
            lines.append("कोई item reorder नहीं हो सका।")

        text = "\n".join(lines)

        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton(
                    "🛒 Cart देखें",
                    callback_data="cart",
                )
            ],
            [
                InlineKeyboardButton(
                    "📦 मेरे Orders",
                    callback_data="orders",
                )
            ],
        ])

    await query.message.reply_text(
        text,
        reply_markup=keyboard,
    )


async def show_order_tracking(query, order_id):
    customer = await get_customer(query.from_user.id)
    order = await get_order_details(customer.id, order_id)

    if not order:
        message = (
            "❌ Order not found."
            if customer.language == "en"
            else
            "❌ Order नहीं मिला।"
        )
        await query.message.reply_text(message)
        return

    tracking = build_order_tracking(order)

    lines = []

    for step in tracking:
        icon = "✅" if step["completed"] else "⬜"
        lines.append(
            f"{icon} {step['label']}"
        )

    if customer.language == "en":
        text = (
            "📦 Order Tracking\n\n"
            f"🆔 {order.order_id}\n\n"
            + "\n".join(lines)
        )
    else:
        text = (
            "📦 Order Tracking\n\n"
            f"🆔 {order.order_id}\n\n"
            + "\n".join(lines)
        )

    await query.message.reply_text(
        text,
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton(
                    "⬅️ My Orders" if customer.language == "en"
                    else "⬅️ मेरे Orders",
                    callback_data="orders",
                )
            ],
            [
                InlineKeyboardButton(
                    "🏠 Main Menu" if customer.language == "en"
                    else "🏠 मुख्य Menu",
                    callback_data="main_menu",
                )
            ],
        ]),
    )


# =========================================================
# PRODUCT DETAILS
# =========================================================

async def show_product_details(
    query,
    product_id,
):

    customer = await get_customer(
        query.from_user.id
    )

    product = await get_product(
        product_id
    )

    if product is None:

        await query.message.reply_text(
            "Product not found."
        )

        return

    if product.available and product.stock > 0:

        availability = "🟢 Available"

    else:

        availability = "🔴 Out of Stock"

    favorite = await is_favorite(
        customer.telegram_user_id,
        product.id,
    )

    if customer.language == "en":

        text = (
            f"📖 Product Details\n\n"
            f"🍬 {product.name}\n\n"
            f"{product.description}\n\n"
            f"💰 Price: ₹{product.price}\n"
            f"📦 Stock: {product.stock}\n"
            f"{availability}"
        )

    else:

        text = (
            f"📖 Product Details\n\n"
            f"🍬 {product.name}\n\n"
            f"{product.description}\n\n"
            f"💰 कीमत: ₹{product.price}\n"
            f"📦 Stock: {product.stock}\n"
            f"{availability}"
        )

    await query.message.reply_text(
        text,
        reply_markup=product_keyboard(
            product.id,
            customer.language,
            favorite,
        ),
    )


# =========================================================
# CALLBACK HANDLER
# =========================================================

async def callback_handler(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
):

    query = update.callback_query

    if query is None:
        return

    await query.answer()

    data = query.data

    # -----------------------------------------------------
    # LANGUAGE
    # -----------------------------------------------------

    if data == "language_hi":

        customer = await update_customer_language(
            query.from_user.id,
            "hi",
        )

        await query.edit_message_text(
            "🇮🇳 भाषा हिंदी में सेट कर दी गई है।"
        )

        await query.message.reply_text(
            f"🍬 Sweet & Snacks में आपका स्वागत है, "
            f"{customer.name}!\n\n"
            "आज क्या करना चाहते हैं?",
            reply_markup=hindi_menu(),
        )

        return

    if data == "language_en":

        customer = await update_customer_language(
            query.from_user.id,
            "en",
        )

        await query.edit_message_text(
            "🇬🇧 Language has been set to English."
        )

        await query.message.reply_text(
            f"🍬 Welcome to Sweet & Snacks, "
            f"{customer.name}!\n\n"
            "What would you like to do?",
            reply_markup=english_menu(),
        )

        return

    # -----------------------------------------------------
    # CART
    # -----------------------------------------------------

    if data == "cart":

        customer = await get_customer(
            query.from_user.id
        )

        # Callback messages do not have update.message,
        # so render the cart directly through the callback message.
        cart = await get_cart_data(
            customer.telegram_user_id
        )

        if not cart["items"]:
            message = (
                "🛒 My Cart\n\nYour cart is empty."
                if customer.language == "en"
                else
                "🛒 मेरी Cart\n\nआपकी Cart खाली है।"
            )
            await query.message.reply_text(message)
            return

        lines = []
        for item in cart["items"]:
            lines.append(
                f"🍬 {item['product_name']}\n"
                f"{item['quantity']} × ₹{item['price']} = ₹{item['subtotal']}"
            )

        if customer.language == "en":
            text = (
                "🛒 MY CART\n\n"
                + "\n\n".join(lines)
                + f"\n\nSubtotal = ₹{cart['subtotal']}"
            )
        else:
            text = (
                "🛒 मेरी CART\n\n"
                + "\n\n".join(lines)
                + f"\n\nSubtotal = ₹{cart['subtotal']}"
            )

        await query.message.reply_text(
            text,
            reply_markup=cart_keyboard(customer.language),
        )
        return

    # -----------------------------------------------------
    # CHECKOUT PLACEHOLDER
    # -----------------------------------------------------

    if data == "checkout":

        customer = await get_customer(
            query.from_user.id
        )

        message = (
            "🛒 Checkout\n\n"
            "Checkout flow will use your saved address, "
            "delivery slot and payment method."
            if customer.language == "en"
            else
            "🛒 Checkout\n\n"
            "Checkout flow में saved address, delivery slot "
            "और payment method इस्तेमाल होंगे।"
        )

        await query.message.reply_text(message)
        return

    # -----------------------------------------------------
    # ORDERS
    # -----------------------------------------------------

    if data == "orders":

        customer = await get_customer(
            query.from_user.id
        )

        await show_orders(
            update,
            customer,
        )
        return

    # -----------------------------------------------------
    # ORDER DETAILS
    # -----------------------------------------------------

    if data.startswith("order_"):

        try:
            order_id = int(data.split("_", 1)[1])
        except ValueError:
            return

        await show_order_details(
            query,
            order_id,
        )
        return

    # -----------------------------------------------------
    # REORDER
    # -----------------------------------------------------

    if data.startswith("reorder_"):

        try:
            order_id = int(data.split("_", 1)[1])
        except ValueError:
            return

        await reorder_customer_order(
            query,
            order_id,
        )
        return

    # -----------------------------------------------------
    # TRACK ORDER
    # -----------------------------------------------------

    if data.startswith("track_"):

        try:
            order_id = int(data.split("_", 1)[1])
        except ValueError:
            return

        await show_order_tracking(
            query,
            order_id,
        )
        return

    # -----------------------------------------------------
    # CATEGORIES
    # -----------------------------------------------------

    if data == "categories":

        customer = await get_customer(
            query.from_user.id
        )

        categories = await get_categories()

        if customer.language == "en":

            text = (
                "📂 Categories\n\n"
                "Please select a category:"
            )

        else:

            text = (
                "📂 Categories\n\n"
                "कृपया category चुनें:"
            )

        await query.message.reply_text(
            text,
            reply_markup=category_keyboard(
                categories,
                customer.language,
            ),
        )

        return

    # -----------------------------------------------------
    # CATEGORY
    # -----------------------------------------------------

    if data.startswith("category_"):

        category_id = int(
            data.split("_")[1]
        )

        await show_products(
            query,
            category_id,
        )

        return

    # -----------------------------------------------------
    # ADD TO CART
    # -----------------------------------------------------

    if data.startswith("addcart_"):

        product_id = int(
            data.split("_")[1]
        )

        success, result = await add_product_to_cart(
            query.from_user.id,
            product_id,
        )

        customer = await get_customer(
            query.from_user.id
        )

        if not success:

            if result == "out_of_stock":

                message = (
                    "🔴 Product is out of stock."
                    if customer.language == "en"
                    else
                    "🔴 यह product stock में नहीं है।"
                )

            elif result == "stock_limit":

                message = (
                    "⚠️ You have reached the available stock limit."
                    if customer.language == "en"
                    else
                    "⚠️ उपलब्ध stock की maximum quantity "
                    "पहले ही Cart में है।"
                )

            else:

                message = (
                    "🔴 Product is unavailable."
                    if customer.language == "en"
                    else
                    "🔴 यह product अभी उपलब्ध नहीं है।"
                )

            await query.message.reply_text(
                message
            )

            return

        if customer.language == "en":

            message = (
                f"✅ Added to cart!\n\n"
                f"Quantity: {result}\n\n"
                "🛒 You can open My Cart from the menu."
            )

        else:

            message = (
                f"✅ Cart में add हो गया!\n\n"
                f"Quantity: {result}\n\n"
                "🛒 Cart देखने के लिए menu में जाएँ।"
            )

        await query.message.reply_text(
            message
        )

        return

    # -----------------------------------------------------
    # FAVORITE
    # -----------------------------------------------------

    if data.startswith("favorite_"):

        product_id = int(
            data.split("_")[1]
        )

        added = await toggle_favorite(
            query.from_user.id,
            product_id,
        )

        customer = await get_customer(
            query.from_user.id
        )

        if added:

            message = (
                "❤️ Added to Favorites!"
                if customer.language == "en"
                else
                "❤️ Favorites में add हो गया!"
            )

        else:

            message = (
                "💔 Removed from Favorites."
                if customer.language == "en"
                else
                "💔 Favorites से remove कर दिया गया।"
            )

        await query.message.reply_text(
            message
        )

        return

    # -----------------------------------------------------
    # DETAILS
    # -----------------------------------------------------

    if data.startswith("details_"):

        product_id = int(
            data.split("_")[1]
        )

        await show_product_details(
            query,
            product_id,
        )

        return

    # -----------------------------------------------------
    # MAIN MENU
    # -----------------------------------------------------

    if data == "main_menu":

        customer = await get_customer(
            query.from_user.id
        )

        if customer.language == "en":

            await query.message.reply_text(
                "🏠 Main Menu",
                reply_markup=english_menu(),
            )

        else:

            await query.message.reply_text(
                "🏠 मुख्य Menu",
                reply_markup=hindi_menu(),
            )

        return


# =========================================================
# TEXT MENU HANDLER
# =========================================================

async def menu_handler(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
):

    if update.message is None:
        return

    telegram_user = update.effective_user

    if telegram_user is None:
        return

    text = update.message.text

    try:
        customer = await get_customer(
            telegram_user.id
        )
    except Customer.DoesNotExist:
        customer, _ = await get_or_create_customer(
            telegram_user
        )

    # -----------------------------------------------------
    # LANGUAGE
    # -----------------------------------------------------

    if text == "🌐 Language":

        await update.message.reply_text(
            "Please select your language.\n\n"
            "कृपया अपनी भाषा चुनें।",
            reply_markup=language_keyboard(),
        )

        return

    # -----------------------------------------------------
    # SHOP
    # -----------------------------------------------------

    if text in [
        "🛍 दुकान देखें",
        "🛍 Shop",
    ]:

        await show_categories_from_message(
            update,
            customer,
        )

        return

    # -----------------------------------------------------
    # SEARCH
    # -----------------------------------------------------

    if text == "🔎 Search":

        await start_search(
            update,
            customer,
        )

        return

    # -----------------------------------------------------
    # FAVORITES
    # -----------------------------------------------------

    if text == "❤️ Favorites":

        await show_favorites(
            update,
            customer,
        )

        return

    # -----------------------------------------------------
    # CART
    # -----------------------------------------------------

    if text in [
        "🛒 मेरी Cart",
        "🛒 My Cart",
    ]:

        await show_cart(
            update,
            customer,
        )

        return

    # -----------------------------------------------------
    # ORDERS
    # -----------------------------------------------------

    if text in [
        "📦 मेरे Orders",
        "📦 My Orders",
    ]:

        await show_orders(
            update,
            customer,
        )

        return

    # -----------------------------------------------------
    # ADDRESS
    # -----------------------------------------------------

    if text in [
        "📍 मेरा Address",
        "📍 My Address",
    ]:

        message = (
            "📍 My Address\n\n"
            "Saved addresses will be available here."
            if customer.language == "en"
            else
            "📍 मेरा Address\n\n"
            "Saved addresses यहाँ दिखाई जाएँगे।"
        )

        await update.message.reply_text(
            message
        )

        return

    # -----------------------------------------------------
    # HELP
    # -----------------------------------------------------

    if text == "☎️ Help":

        message = (
            "☎️ Help\n\n"
            "Please contact our support team."
            if customer.language == "en"
            else
            "☎️ Help\n\n"
            "किसी भी सहायता के लिए support से संपर्क करें।"
        )

        await update.message.reply_text(
            message
        )

        return

    # -----------------------------------------------------
    # SEARCH TEXT
    # -----------------------------------------------------

    await show_search_results(
        update,
        text.strip(),
    )


# =========================================================
# RUN BOT
# =========================================================

def run_bot():

    token = os.getenv(
        "TELEGRAM_BOT_TOKEN"
    )

    if not token:
        try:
            from django.conf import settings
            token = getattr(
                settings,
                "TELEGRAM_BOT_TOKEN",
                "",
            )
        except Exception:
            token = ""

    if not token:

        raise ValueError(
            "TELEGRAM_BOT_TOKEN is not configured in .env"
        )

    application = (
        Application.builder()
        .token(token)
        .build()
    )

    # /start
    application.add_handler(
        CommandHandler(
            "start",
            start,
        )
    )

    # Inline buttons
    application.add_handler(
        CallbackQueryHandler(
            callback_handler
        )
    )

    # Text messages
    application.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            menu_handler,
        )
    )

    print(
        "Telegram bot is running..."
    )

    application.run_polling(
        drop_pending_updates=True
    )