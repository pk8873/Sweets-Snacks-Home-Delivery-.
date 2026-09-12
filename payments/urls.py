from django.urls import path

from .views import telegram_payment, telegram_payment_failed, telegram_payment_verify

urlpatterns = [
    path("telegram/<str:order_id>/", telegram_payment, name="telegram_payment"),
    path("telegram/<str:order_id>/verify/", telegram_payment_verify, name="telegram_payment_verify"),
    path("telegram/<str:order_id>/failed/", telegram_payment_failed, name="telegram_payment_failed"),
]
