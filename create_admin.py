import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.contrib.auth import get_user_model


User = get_user_model()

username = os.getenv("DJANGO_ADMIN_USERNAME", "").strip()
email = os.getenv("DJANGO_ADMIN_EMAIL", "").strip()
password = os.getenv("DJANGO_ADMIN_PASSWORD", "")

if not username or not password:
    print("DJANGO_ADMIN_USERNAME and DJANGO_ADMIN_PASSWORD must be set.")
    raise SystemExit(1)

user = User.objects.filter(username=username).first()

if user is None:
    user = User(username=username)
    created = True
else:
    created = False

user.email = email
user.is_staff = True
user.is_superuser = True
user.set_password(password)
user.save()

if created:
    print(f"Production superuser '{username}' created successfully.")
else:
    print(f"Production superuser '{username}' updated successfully.")
