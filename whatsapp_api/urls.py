from django.urls import path

from .views import api, product_image


urlpatterns = [
    path("", api, {"action": "menu"}, name="whatsapp_api_menu"),
    path("categories/", api, {"action": "menu"}, name="whatsapp_api_categories"),
    path("products/", api, {"action": "products"}, name="whatsapp_api_products"),
    path("products/<int:product_id>/image/", product_image, name="whatsapp_api_product_image"),
    path("customer/", api, {"action": "customer"}, name="whatsapp_api_customer"),
    path("cart/", api, {"action": "cart"}, name="whatsapp_api_cart"),
    path("cart/add/", api, {"action": "cart/add"}, name="whatsapp_api_cart_add"),
    path("cart/remove/", api, {"action": "cart/remove"}, name="whatsapp_api_cart_remove"),
    path("address/", api, {"action": "address"}, name="whatsapp_api_address"),
    path("checkout/", api, {"action": "checkout"}, name="whatsapp_api_checkout"),
    path("orders/", api, {"action": "orders"}, name="whatsapp_api_orders"),
    path("order/", api, {"action": "order"}, name="whatsapp_api_order"),
]
