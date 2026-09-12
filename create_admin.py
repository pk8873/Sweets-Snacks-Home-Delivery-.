import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

username = os.getenv("DJANGO_ADMIN_USERNAME", "admin").strip() or "admin"
email = os.getenv("DJANGO_ADMIN_EMAIL", "").strip()
password = os.getenv("DJANGO_ADMIN_PASSWORD", "")

if not password:
    print("ERROR: DJANGO_ADMIN_PASSWORD is not configured. Set it in Render Environment Variables and redeploy.")
    raise SystemExit(1)

user = User.objects.filter(username=username).first()
created = user is None

if created:
    user = User(username=username)

user.email = email
user.is_staff = True
user.is_superuser = True
user.is_active = True
user.set_password(password)
user.save()

if created:
    print(f"Production superuser '{username}' created successfully.")
else:
    print(f"Production superuser '{username}' updated successfully.")
