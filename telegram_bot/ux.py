import html
from decimal import Decimal
from io import BytesIO

from asgiref.sync import sync_to_async
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove

from cart.models import Cart, CartItem
from customers.models import Customer
from products.models import Category, Favorite, Product

from . import bot


def safe(value):
    return html.escape(str(value or ""))


def category_icon(category):
    custom = getattr(category, "emoji", "")
    return custom.strip() if custom and custom.strip() else bot.category_icon(category.name)


def patch_weight_options(product):
    base = max(int(product.weight_grams or 1000), 1)
    if base < 250:
        return [base]
    values = [250, 500, 750, 1000]
    values = [value for value in values if value <= base]
    if base not in values:
        values.append(base)
    return sorted(set(values))


def patch_price_text(product):
    if not product.is_weight_based:
        return bot.money(product.price) + " / pc"
    if product.selling_unit == "kg" or int(product.weight_grams or 0) == 1000:
        return f"{bot.money(product.price)} / kg"
    return f"{bot.money(product.price)} / {bot.weight_label(product.weight_grams)}"


async def show_categories(update):
    categories = await bot.get_categories()
    if not categories:
        await update.effective_message.reply_text("📂 अभी कोई category उपलब्ध नहीं है।")
        return

    rows = []
    for i in range(0, len(categories), 2):
        rows.append([
            InlineKeyboardButton(
                f"{category_icon(c)} {c.name[:20]}",
                callback_data=f"category_{c.id}",
            )
            for c in categories[i:i + 2]
        ])
    rows += [
        [InlineKeyboardButton("🔎 Search", callback_data="search_menu")],
        [InlineKeyboardButton("🛒 Cart", callback_data="cart"), InlineKeyboardButton("🏠 Home", callback_data="main_menu")],
    ]
    await update.effective_message.reply_text(
        "🛍 <b>SHOP</b>\n\nCategory चुनें:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(rows),
    )


async def show_category_products(update, category_id):
    message = update.effective_message
    user = update.effective_user
    products = await bot.get_products(category_id)
    if not products:
        await message.reply_text(
            "😔 इस category में अभी product उपलब्ध नहीं है।",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Categories", callback_data="categories")]]),
        )
        return

    favs = await bot.favorite_ids(user.id, [p.id for p in products])
    category = products[0].category
    await message.reply_text(
        f"{category_icon(category)} <b>{safe(category.name.upper())}</b>\n\n"
        "नीचे product चुनें:",
        parse_mode="HTML",
    )

    # One compact product card = image + details + choose button.
    for product in products:
        star = " ❤️" if product.id in favs else ""
        caption = (
            f"🍬 <b>{safe(product.name)}</b>{star}\n"
            f"💰 {safe(patch_price_text(product))}\n"
            f"{safe(bot.stock_text(product))}"
        )
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("🛍 Choose", callback_data=f"product_{product.id}"), InlineKeyboardButton("❤️ Favorite", callback_data=f"favorite_{product.id}")],
        ])
        photo = bot.prepare_telegram_photo(product)
        try:
            if photo:
                await message.reply_photo(photo=photo, caption=caption, parse_mode="HTML", reply_markup=keyboard)
            else:
                await message.reply_text(caption, parse_mode="HTML", reply_markup=keyboard)
        except Exception:
            await message.reply_text(caption, parse_mode="HTML", reply_markup=keyboard)

    await message.reply_text(
        "✨ Ready to order?",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🛒 Cart", callback_data="cart"), InlineKeyboardButton("🔎 Search", callback_data="search_menu")],
            [InlineKeyboardButton("⬅️ Categories", callback_data="categories"), InlineKeyboardButton("🏠 Home", callback_data="main_menu")],
        ]),
    )


async def render_product(update, product, context):
    user = update.effective_user
    key_qty = f"qty_{product.id}"
    key_weight = f"weight_{product.id}"
    qty = max(int(context.user_data.get(key_qty, 1)), 1)
    options = patch_weight_options(product)
    weight = int(context.user_data.get(key_weight, options[0])) if product.is_weight_based else 0
    if weight not in options and product.is_weight_based:
        weight = options[0]
        context.user_data[key_weight] = weight

    unit_price = bot.price_for_weight(product, weight) if product.is_weight_based else Decimal(product.price)
    total = unit_price * qty
    fav = await bot.is_fav(user.id, product.id)

    if product.is_weight_based:
        selection = f"⚖️ {bot.weight_label(weight)} × {qty}"
        price_line = f"💰 {bot.money(unit_price)} / {bot.weight_label(weight)}"
    else:
        selection = f"🔢 {qty} pcs"
        price_line = f"💰 {bot.money(unit_price)} / pc"

    text = (
        f"🍬 <b>{safe(product.name)}</b>\n\n"
        f"{safe(product.description or 'Freshly prepared and carefully packed.')}\n\n"
        f"{price_line}\n"
        f"{selection}\n"
        f"🧾 <b>Total: {bot.money(total)}</b>\n"
        f"{safe(bot.stock_text(product))}"
    )
    rows = []
    if product.is_weight_based:
        weight_buttons = [
            InlineKeyboardButton(("✅ " if weight == g else "") + bot.weight_label(g), callback_data=f"weight_{product.id}_{g}")
            for g in options
        ]
        for i in range(0, len(weight_buttons), 2):
            rows.append(weight_buttons[i:i + 2])
    rows.append([
        InlineKeyboardButton("➖", callback_data=f"qtydec_{product.id}"),
        InlineKeyboardButton(f"Qty {qty}", callback_data="noop"),
        InlineKeyboardButton("➕", callback_data=f"qtyinc_{product.id}"),
    ])
    rows.append([
        InlineKeyboardButton("🛒 Add to Cart", callback_data=f"addcart_{product.id}"),
        InlineKeyboardButton("⚡ Buy Now", callback_data=f"buynow_{product.id}"),
    ])
    rows.append([
        InlineKeyboardButton("💔 Remove Favorite" if fav else "❤️ Favorite", callback_data=f"favorite_{product.id}"),
        InlineKeyboardButton("🛒 Cart", callback_data="cart"),
    ])
    rows.append([InlineKeyboardButton("⬅️ Back to Products", callback_data=f"category_{product.category_id}")])
    keyboard = InlineKeyboardMarkup(rows)

    # Quantity/weight changes edit the same Telegram message instead of creating
    # another product template on every tap.
    target = update.effective_message
    try:
        if getattr(target, "photo", None) and getattr(target, "caption", None) is not None:
            await target.edit_caption(caption=text, parse_mode="HTML", reply_markup=keyboard)
            return
        if getattr(target, "text", None) is not None:
            await target.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
            return
    except Exception:
        pass

    photo = bot.prepare_telegram_photo(product)
    if photo:
        await target.reply_photo(photo=photo, caption=text, parse_mode="HTML", reply_markup=keyboard)
    else:
        await target.reply_text(text, parse_mode="HTML", reply_markup=keyboard)


@sync_to_async
def add_to_cart(user_id, product_id, qty, weight):
    customer = Customer.objects.get(telegram_user_id=user_id)
    product = Product.objects.filter(id=product_id, available=True).first()
    if not product:
        return False, "not_found", 0
    qty = max(int(qty), 1)

    if product.is_weight_based:
        if weight not in patch_weight_options(product):
            return False, "weight", 0
        if qty * weight > product.stock_grams:
            return False, "stock", 0
    elif qty > product.stock:
        return False, "stock", 0

    cart, _ = Cart.objects.get_or_create(customer=customer)
    lookup = {"cart": cart, "product": product}
    if product.is_weight_based:
        lookup["quantity_grams"] = weight
    else:
        lookup["quantity_grams"] = 0
    item = CartItem.objects.filter(**lookup).first()
    if item:
        new_qty = item.quantity + qty
        if product.is_weight_based and new_qty * item.quantity_grams > product.stock_grams:
            return False, "stock", item.quantity
        if not product.is_weight_based and new_qty > product.stock:
            return False, "stock", item.quantity
        item.quantity = new_qty
        item.price = product.price
        item.save()
    else:
        item = CartItem.objects.create(
            cart=cart,
            product=product,
            quantity=qty,
            quantity_grams=weight if product.is_weight_based else 0,
            price=product.price,
        )
    return True, "added", item.quantity


async def show_cart(update):
    items = await bot.cart_items(update.effective_user.id)
    if not items:
        await update.effective_message.reply_text(
            "🛒 <b>Cart Empty</b>\n\nShop से product चुनें।",
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
            unit = bot.price_for_weight(p, item.quantity_grams)
            subtotal = unit * item.quantity
            label = f"{item.quantity} × {bot.weight_label(item.quantity_grams)}"
        else:
            subtotal = item.price * item.quantity
            label = f"{item.quantity} × pc"
        total += subtotal
        lines.append(f"🍬 <b>{safe(p.name)}</b> • {label} • <b>{bot.money(subtotal)}</b>")
        rows.append([
            InlineKeyboardButton("➖", callback_data=f"cartitemdec_{item.id}"),
            InlineKeyboardButton(f"{item.quantity} × {p.name[:12]}", callback_data=f"product_{p.id}"),
            InlineKeyboardButton("➕", callback_data=f"cartiteminc_{item.id}"),
        ])
        rows.append([InlineKeyboardButton("🗑 Remove", callback_data=f"cartitemremove_{item.id}")])
    lines.append(f"\n💰 <b>Subtotal: {bot.money(total)}</b>")
    rows += [
        [InlineKeyboardButton("💳 Checkout", callback_data="checkout")],
        [InlineKeyboardButton("🛍 Continue Shopping", callback_data="categories")],
        [InlineKeyboardButton("🧹 Clear Cart", callback_data="clear_cart")],
    ]
    await update.effective_message.reply_text("\n".join(lines), parse_mode="HTML", reply_markup=InlineKeyboardMarkup(rows))


@sync_to_async
def change_cart_item(user_id, item_id, delta):
    customer = Customer.objects.get(telegram_user_id=user_id)
    item = CartItem.objects.select_related("product").filter(id=item_id, cart__customer=customer).first()
    if not item:
        return "missing", 0
    new_qty = item.quantity + delta
    if new_qty <= 0:
        item.delete()
        return "removed", 0
    product = item.product
    required = new_qty * item.quantity_grams if product.is_weight_based else new_qty
    available = product.stock_grams if product.is_weight_based else product.stock
    if required > available:
        return "stock", item.quantity
    item.quantity = new_qty
    item.save()
    return "updated", new_qty


async def show_orders(update):
    customer = await bot.get_customer(update.effective_user.id)
    orders = await bot.get_customer_orders(customer.id)
    if not orders:
        await update.effective_message.reply_text(
            "📦 अभी कोई order नहीं है।",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Shop Now", callback_data="categories")]]),
        )
        return
    # Keep the bot light: only the 5 latest orders are shown in compact rows.
    await update.effective_message.reply_text("📦 <b>MY ORDERS</b>\nRecent 5 orders", parse_mode="HTML")
    for index, order in enumerate(orders[:5], 1):
        line = f"{index}. 🗓 {order.created_at:%d %b} • {order.created_at:%H:%M} • {money(order.total_amount)}"
        await update.effective_message.reply_text(
            line,
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📋 Details", callback_data=f"order_{order.order_id}"), InlineKeyboardButton("📍 Track", callback_data=f"track_{order.order_id}")],
            ]),
        )


async def handle_contact(update, context):
    contact = update.message.contact
    if not contact or not update.effective_user:
        return
    if contact.user_id and contact.user_id != update.effective_user.id:
        await update.message.reply_text("❌ कृपया अपना ही mobile number share करें।")
        return
    context.user_data["shared_phone"] = contact.phone_number
    context.user_data["address_mode"] = "contact_confirm"
    await update.message.reply_text(
        f"📱 <b>Mobile number received</b>\n\n<code>{safe(contact.phone_number)}</code>\n\nइसी number को save करें?",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("✅ Accept & Save", callback_data="accept_phone")],
            [InlineKeyboardButton("✏️ Change Number", callback_data="change_phone"), InlineKeyboardButton("✖️ Cancel", callback_data="cancel_phone")],
        ]),
    )


def patch_callback_handler(original):
    async def wrapped(update, context):
        data = update.callback_query.data or ""
        user = update.effective_user
        query = update.callback_query
        if data.startswith("cartiteminc_") or data.startswith("cartitemdec_"):
            await query.answer()
            item_id = int(data.rsplit("_", 1)[1])
            result, qty = await change_cart_item(user.id, item_id, 1 if data.startswith("cartiteminc_") else -1)
            if result == "stock":
                await query.message.reply_text(f"⚠️ Maximum available quantity: {qty}")
            await show_cart(update)
            return
        if data.startswith("cartitemremove_"):
            await query.answer()
            item_id = int(data.rsplit("_", 1)[1])
            customer = await bot.get_customer(user.id)
            await sync_to_async(CartItem.objects.filter(id=item_id, cart__customer=customer).delete)()
            await show_cart(update)
            return
        if data == "accept_phone":
            await query.answer()
            phone = context.user_data.get("shared_phone")
            if phone:
                await bot.update_customer_phone(user.id, phone)
            context.user_data["address_mode"] = "address"
            context.user_data.pop("shared_phone", None)
            await query.message.reply_text(
                "✅ Mobile number saved.\n\nअब <b>House/Street/Village, City, Pincode</b> लिखें।",
                parse_mode="HTML",
                reply_markup=ReplyKeyboardMarkup([["✖️ Cancel"]], resize_keyboard=True),
            )
            return
        if data == "change_phone":
            await query.answer()
            context.user_data["address_mode"] = "contact"
            await query.message.reply_text("📱 नया mobile number share करें:", reply_markup=bot.address_contact_keyboard())
            return
        if data == "cancel_phone":
            await query.answer()
            context.user_data.pop("shared_phone", None)
            context.user_data.pop("address_mode", None)
            await query.message.reply_text("❌ Cancelled.", reply_markup=ReplyKeyboardRemove())
            return
        await original(update, context)
    return wrapped


def apply():
    bot.weight_options = patch_weight_options
    bot.price_text = patch_price_text
    bot.show_categories = show_categories
    bot.show_category_products = show_category_products
    bot.render_product = render_product
    bot.add_to_cart = add_to_cart
    bot.show_cart = show_cart
    bot.show_orders = show_orders
    bot.handle_contact = handle_contact
    bot.callback_handler = patch_callback_handler(bot.callback_handler)
