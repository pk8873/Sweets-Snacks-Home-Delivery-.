import os
from pathlib import Path
from urllib.parse import urlparse, urlsplit, urlunsplit

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
# ADMIN / SESSION
# ============================================================
# Keep the Django admin login session alive across Category/Product
# add/edit pages. The session is still ended when the user explicitly logs
# out, and it is stored in the database used by the Django service.
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14  # 14 days
SESSION_EXPIRE_AT_BROWSER_CLOSE = False
SESSION_SAVE_EVERY_REQUEST = True
SESSION_COOKIE_HTTPONLY = True

# Render terminates HTTPS at its proxy. Tell Django which original protocol
# the client used so secure cookies and CSRF handling work correctly.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True


# ============================================================
# CSRF / RENDER ORIGIN
# ============================================================

CSRF_TRUSTED_ORIGINS = []
if RENDER_EXTERNAL_HOSTNAME:
    CSRF_TRUSTED_ORIGINS.append(
        f"https://{RENDER_EXTERNAL_HOSTNAME}"
    )


# ============================================================
# TELEGRAM
# ============================================================
# The webhook setup script reads TELEGRAM_BOT_TOKEN directly from the
# environment, while telegram_bot.bot reads it from Django settings.
# Expose the same Render environment variables through settings so both
# startup webhook configuration and incoming webhook processing use the
# exact same credentials/configuration.
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_WEBHOOK_SECRET = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()
TELEGRAM_WEBHOOK_URL = os.getenv("TELEGRAM_WEBHOOK_URL", "").strip()


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
    # Supabase's session pooler uses port 5432 and has a small fixed
    # session pool. For the Django web/API workload, use the transaction
    # pooler automatically when the configured host is Supabase's pooler.
    # This avoids holding a PostgreSQL session open between requests.
    database_url = DATABASE_URL
    try:
        parsed = urlsplit(database_url)
        hostname = (parsed.hostname or "").lower()
        if hostname.endswith(".pooler.supabase.com") and parsed.port == 5432:
            netloc = parsed.hostname
            if parsed.username:
                from urllib.parse import quote
                netloc = quote(parsed.username, safe="") + "@" + netloc
            if parsed.password:
                from urllib.parse import quote
                user_part = quote(parsed.username or "", safe="")
                netloc = user_part + ":" + quote(parsed.password, safe="") + "@" + parsed.hostname
            if parsed.port:
                netloc += ":6543"
            database_url = urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))
    except ValueError:
        database_url = DATABASE_URL

    DATABASES = {
        "default": dj_database_url.parse(
            database_url,
            conn_max_age=0,
            ssl_require=True,
        )
    }
    DATABASES["default"].setdefault("OPTIONS", {})
    # Transaction pooling cannot safely keep Django server-side cursors.
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
    # Psycopg3 prepared statements are connection-specific and should not be
    # retained when requests can move between transaction-pooler backends.
    DATABASES["default"]["OPTIONS"]["prepare_threshold"] = None
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
