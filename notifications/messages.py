def get_status_message(order_id, status, language="hi"):
    messages = {
        "hi": {
            "pending": (
                f"🆕 नया Order प्राप्त हुआ!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"⏳ आपका Order जल्द process किया जाएगा।"
            ),

            "confirmed": (
                f"🎉 आपका Order Confirm हो गया!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"✅ आपका Order स्वीकार कर लिया गया है।"
            ),

            "preparing": (
                f"👨‍🍳 आपका Order तैयार किया जा रहा है।\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"कृपया थोड़ा इंतज़ार करें।"
            ),

            "ready": (
                f"📦 आपका Order तैयार है!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"🚚 जल्द ही Delivery के लिए भेजा जाएगा।"
            ),

            "out_for_delivery": (
                f"🚚 आपका Order रास्ते में है!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"📍 आपका Order जल्द ही आपके पास पहुँचेगा।"
            ),

            "delivered": (
                f"🎉 आपका Order Delivered हो गया!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"🙏 हमारे साथ खरीदारी करने के लिए धन्यवाद।"
            ),

            "cancelled": (
                f"❌ आपका Order Cancel कर दिया गया है।\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"यदि आपको लगता है कि यह गलती है, तो Help से संपर्क करें।"
            ),
        },

        "en": {
            "pending": (
                f"🆕 New Order Received!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"⏳ Your order will be processed soon."
            ),

            "confirmed": (
                f"🎉 Your Order has been Confirmed!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"✅ Your order has been accepted."
            ),

            "preparing": (
                f"👨‍🍳 Your Order is being prepared.\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"Please wait a little."
            ),

            "ready": (
                f"📦 Your Order is Ready!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"🚚 It will be sent for delivery soon."
            ),

            "out_for_delivery": (
                f"🚚 Your Order is Out for Delivery!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"📍 Your order will reach you soon."
            ),

            "delivered": (
                f"🎉 Your Order has been Delivered!\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"🙏 Thank you for shopping with us."
            ),

            "cancelled": (
                f"❌ Your Order has been Cancelled.\n\n"
                f"🆔 Order ID: {order_id}\n\n"
                f"If you think this is a mistake, please contact Help."
            ),
        },
    }

    language = language if language in messages else "hi"

    return messages[language].get(
        status,
        f"📦 Order {order_id}\nStatus: {status}",
    )