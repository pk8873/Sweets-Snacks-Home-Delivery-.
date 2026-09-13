# Sweet & Snacks WhatsApp Bot

This service adds a WhatsApp shopping interface using Baileys while reusing the existing Django products, customers, cart, orders and Razorpay backend.

## Local setup

From the project root:

```powershell
cd whatsapp_bot
npm install
```

Create `.env` from `.env.example` and use the same `WHATSAPP_BOT_SECRET` value that Django uses.

Start Django in another terminal:

```powershell
python manage.py migrate
python manage.py runserver
```

Then start the WhatsApp service:

```powershell
cd whatsapp_bot
npm start
```

A QR code is printed in the terminal. On the phone running the WhatsApp account you want to link, open **WhatsApp > Settings > Linked Devices > Link a Device** and scan the QR code.

The login session is stored under `whatsapp_bot/auth_info/`. This directory is ignored by Git because it contains long-lived WhatsApp credentials.

## Supported customer flow

- Welcome / main menu
- Categories
- Product list and admin-uploaded product images
- Product details
- 250g / 500g / 750g / 1kg weight selection for weight products
- Piece quantity for countable products
- Cart using the existing Django cart
- Saved/default delivery address
- New address capture
- Cash on Delivery
- Online Razorpay payment page
- Order ID and confirmation
- My Orders
- Order details
- Current admin-controlled order tracking status
- Contact/help

## Environment

`DJANGO_API_URL` must point to the Django `/whatsapp/api` endpoint.

`WHATSAPP_BOT_SECRET` must be identical in Django and Node.js. Never commit a real secret or the `auth_info` directory.

## Render

The root `render.yaml` defines a separate Node web service for the WhatsApp bot. The free Render filesystem is ephemeral, so the Baileys session can be lost after a restart/redeploy. For a durable production session, move Baileys authentication state to persistent storage before relying on the service for a business number.

## Important

Baileys is an unofficial WhatsApp Web client, not the official Meta WhatsApp Business Cloud API. Use it responsibly and do not use it for spam or bulk unsolicited messaging. The upstream project documents the authentication/session model and warns that file-based auth state is mainly a simple utility rather than the recommended production-grade storage strategy.
