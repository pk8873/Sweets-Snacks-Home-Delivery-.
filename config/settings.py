import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
import dj_database_url


BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


# ============================================================
# SECURITY
# ============================================================

SECRET_KEY = os.getenv("SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is not set")

DEBUG = os.getenv("DEBUG", "False").lower() == "true"


# ============================================================
# RENDER
# ============================================================

RENDER = os.getenv("RENDER", "") == "true"

RENDER_EXTERNAL_HOSTNAME = os.getenv(
    "RENDER_EXTERNAL_HOSTNAME",
    "",
).strip()


# ============================================================
# HOSTS
# ============================================================

ALLOWED_HOSTS = [
    "127.0.0.1",
    "localhost",
]

if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)


# ============================================================
# APPS
# ============================================================

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    "cloudinary_storage",
    "cloudinary",

    "products",
    "customers",
    "cart",
    "orders",
    "payments",
    "delivery",
    "notifications.apps.NotificationsConfig",
    "telegram_bot",
    "whatsapp_api.apps.WhatsappApiConfig",
]


# ============================================================
# MIDDLEWARE
# ============================================================

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",

    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


# ============================================================
# URL
# ============================================================

ROOT_URLCONF = "config.urls"


# ============================================================
# TEMPLATES
# ============================================================

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [
            BASE_DIR / "templates",
        ],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


# ============================================================
# WSGI / ASGI
# ============================================================

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"


# ============================================================
# DATABASE
# ============================================================

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=600,
            ssl_require=True,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


# ============================================================
# PASSWORD VALIDATION
# ============================================================

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "MinimumLengthValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "CommonPasswordValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "NumericPasswordValidator"
        ),
    },
]


# ============================================================
# INTERNATIONALIZATION
# ============================================================

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True


# ============================================================
# STATIC + MEDIA STORAGE
# ============================================================

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STATICFILES_DIRS = [
    BASE_DIR / "static",
]

# Render Free has an ephemeral filesystem. Product/category images therefore
# use Cloudinary when valid Cloudinary credentials are configured.
# The preferred value is CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME.
# Separate CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET variables are also supported.
cloudinary_url = os.getenv("CLOUDINARY_URL", "").strip()

if not cloudinary_url:
    cloudinary_cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    cloudinary_api_key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    cloudinary_api_secret = os.getenv("CLOUDINARY_API_SECRET", "").strip()

    if all((cloudinary_cloud_name, cloudinary_api_key, cloudinary_api_secret)):
        cloudinary_url = (
            f"cloudinary://{cloudinary_api_key}:{cloudinary_api_secret}"
            f"@{cloudinary_cloud_name}"
        )
        os.environ["CLOUDINARY_URL"] = cloudinary_url

cloudinary_parts = urlparse(cloudinary_url) if cloudinary_url else None
cloudinary_configured = bool(
    cloudinary_parts
    and cloudinary_parts.scheme == "cloudinary"
    and cloudinary_parts.hostname
    and cloudinary_parts.username
    and cloudinary_parts.password
)

if RENDER and cloudinary_url and not cloudinary_configured:
    raise RuntimeError(
        "CLOUDINARY_URL is incomplete. Set it to "
        "cloudinary://API_KEY:API_SECRET@CLOUD_NAME in Render, "
        "or set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and "
        "CLOUDINARY_API_SECRET."
    )

USE_CLOUDINARY = cloudinary_configured

STORAGES = {
    "default": {
        "BACKEND": (
            "cloudinary_storage.storage.MediaCloudinaryStorage"
            if USE_CLOUDINARY
            else "django.core.files.storage.FileSystemStorage"
        ),
    },
    "staticfiles": {
        "BACKEND": (
            "whitenoise.storage."
            "CompressedManifestStaticFilesStorage"
        ),
    },
}

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"


# ============================================================
# PRIMARY KEY
# ============================================================

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# ============================================================
# TELEGRAM
# ============================================================

TELEGRAM_BOT_TOKEN = os.getenv(
    "TELEGRAM_BOT_TOKEN",
    "",
).strip()

TELEGRAM_WEBHOOK_SECRET = os.getenv(
    "TELEGRAM_WEBHOOK_SECRET",
    "",
).strip()

TELEGRAM_WEBHOOK_URL = os.getenv(
    "TELEGRAM_WEBHOOK_URL",
    "",
).strip()


# ============================================================
# WHATSAPP / BAILEYS
# ============================================================

WHATSAPP_BOT_SECRET = os.getenv(
    "WHATSAPP_BOT_SECRET",
    "",
).strip()
