from django.urls import path

from .views import telegram_payment

urlpatterns = [
    path("telegram/<str:order_id>/", telegram_payment, name="telegram_payment"),
]
