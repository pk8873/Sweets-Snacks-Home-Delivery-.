"""URL configuration for the Sweet & Snacks project."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from .views import health_check


urlpatterns = [
    path("", health_check, name="root-health"),
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health"),
    path("telegram/", include("telegram_bot.urls")),
    path("whatsapp/api/", include("whatsapp_api.urls")),
    path("payments/", include("payments.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
