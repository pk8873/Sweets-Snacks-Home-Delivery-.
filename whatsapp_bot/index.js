import "dotenv/config";
import http from "node:http";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";

import {
  addToCart,
  checkout,
  getCart,
  getCategories,
  getCustomer,
  getOrder,
  getOrders,
  getProducts,
  removeCartItem,
  saveAddress,
} from "./api.js";

const PORT = Number(process.env.PORT || 10000);
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || "./auth_info";
const logger = P({ level: process.env.LOG_LEVEL || "info" });
const sessions = new Map();

function getText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ""
  ).trim();
}

function phoneFromJid(jid) {
  return (jid || "").split("@")[0].replace(/\D/g, "").slice(-15);
}

function getSession(waId, displayName) {
  let state = sessions.get(waId);
  if (!state) {
    state = { step: "main", displayName: displayName || "Customer" };
    sessions.set(waId, state);
  }
  if (displayName) state.displayName = displayName;
  return state;
}

async function customerPayload(jid, displayName) {
  const waId = jid;
  const phone = phoneFromJid(jid);
  return getCustomer({ wa_id: waId, phone, display_name: displayName || "Customer" });
}

async function sendMainMenu(sock, jid) {
  const state = getSession(jid);
  state.step = "main";
  state.category = null;
  state.products = null;
  state.product = null;
  state.order = null;

  await sock.sendMessage(jid, {
    text:
      "🍬 *Sweet & Snacks Home Delivery*\n\n" +
      "नमस्ते! आपका स्वागत है।\n\n" +
      "1️⃣ 🛍️ Shop\n" +
      "2️⃣ 🛒 Cart\n" +
      "3️⃣ 📦 My Orders\n" +
      "4️⃣ 📍 Track Order\n" +
      "5️⃣ 📞 Contact\n\n" +
      "किसी option का number भेजें।\n\n" +
      "`menu` = Main Menu",
  });
}

async function sendCategories(sock, jid) {
  const result = await getCategories();
  const state = getSession(jid);
  state.step = "category";
  state.categories = result.categories;

  if (!result.categories.length) {
    await sock.sendMessage(jid, { text: "😔 अभी कोई category उपलब्ध नहीं है।" });
    return;
  }

  const lines = result.categories.map(
    (category, index) => `${index + 1}️⃣ ${category.emoji} ${category.name}`,
  );
  await sock.sendMessage(jid, {
    text: "🛍️ *SHOP*\n\n" + lines.join("\n") + "\n\n`menu` = Main Menu",
  });
}

async function sendProducts(sock, jid, category) {
  const result = await getProducts(category.id);
  const state = getSession(jid);
  state.step = "product";
  state.category = category;
  state.products = result.products;

  if (!result.products.length) {
    await sock.sendMessage(jid, {
      text: "😔 इस category में अभी कोई product उपलब्ध नहीं है।",
    });
    return;
  }

  await sock.sendMessage(jid, {
    text: `${category.emoji} *${category.name.toUpperCase()}*\n\nProduct number भेजें।`,
  });

  for (let index = 0; index < result.products.length; index += 1) {
    const product = result.products[index];
    const stock = product.is_weight_based ? product.stock_display : `${product.stock} pcs`;
    const caption =
      `${index + 1}. *${product.name}*\n` +
      `${product.description ? `${product.description}\n` : ""}` +
      `💰 ₹${product.price} / ${product.price_quantity_label}\n` +
      `📦 ${stock}\n` +
      (product.is_weight_based ? "⚖️ Weight product\n" : "🔢 Piece product\n") +
      "\nSend product number to continue.";

    if (product.image_url) {
      try {
        await sock.sendMessage(jid, {
          image: { url: product.image_url },
          caption,
        });
        continue;
      } catch (error) {
        logger.warn({ error, productId: product.id }, "Product image send failed");
      }
    }

    await sock.sendMessage(jid, { text: caption });
  }
}

async function showProduct(sock, jid, product) {
  const state = getSession(jid);
  state.product = product;

  if (product.is_weight_based) {
    state.step = "weight";
    await sock.sendMessage(jid, {
      text:
        `🍬 *${product.name}*\n\n` +
        `💰 ₹${product.price} / ${product.price_quantity_label}\n\n` +
        "Weight चुनें:\n\n" +
        "1️⃣ 250 g\n" +
        "2️⃣ 500 g\n" +
        "3️⃣ 750 g\n" +
        "4️⃣ 1 kg\n\n" +
        "`back` = Products",
    });
    return;
  }

  state.step = "piece_quantity";
  await sock.sendMessage(jid, {
    text:
      `🥟 *${product.name}*\n\n` +
      `💰 ₹${product.price} / piece\n` +
      `📦 ${product.stock} available\n\n` +
      "कितने pieces चाहिए? Number भेजें।",
  });
}

async function addSelectedProduct(sock, jid, quantity, quantityGrams = 0) {
  const state = getSession(jid);
  const product = state.product;
  if (!product) return;

  const result = await addToCart({
    wa_id: jid,
    phone: phoneFromJid(jid),
    display_name: state.displayName,
    product_id: product.id,
    quantity,
    quantity_grams: quantityGrams,
  });

  await sock.sendMessage(jid, {
    text:
      `✅ *${product.name}* cart में add हो गया।\n\n` +
      "🛒 `cart` भेजकर cart देखें।\n" +
      "🛍️ `shop` भेजकर shopping जारी रखें।",
  });
  state.step = "main";
  state.product = null;
  return result;
}

async function showCart(sock, jid) {
  const result = await getCart({
    wa_id: jid,
    phone: phoneFromJid(jid),
    display_name: getSession(jid).displayName,
  });
  const state = getSession(jid);
  state.step = "cart";

  if (!result.items.length) {
    await sock.sendMessage(jid, {
      text: "🛒 *YOUR CART*\n\nCart अभी खाली है।\n\n`shop` = Shopping",
    });
    return;
  }

  const lines = result.items.map((item, index) => {
    const weight = item.quantity_grams ? ` • ${item.quantity_grams} g` : "";
    return `${index + 1}. ${item.name}${weight}\n   Qty: ${item.quantity} • ₹${item.subtotal}`;
  });

  await sock.sendMessage(jid, {
    text:
      "🛒 *YOUR CART*\n\n" +
      lines.join("\n\n") +
      `\n\n━━━━━━━━━━━━\nSubtotal: ₹${result.subtotal}\nItems: ${result.total_items}\n\n` +
      "`checkout` = Checkout\n`shop` = Continue Shopping\n`menu` = Main Menu",
  });
}

async function showOrders(sock, jid) {
  const result = await getOrders({
    wa_id: jid,
    phone: phoneFromJid(jid),
    display_name: getSession(jid).displayName,
  });
  const state = getSession(jid);
  state.step = "orders";

  if (!result.orders.length) {
    await sock.sendMessage(jid, { text: "📦 अभी कोई order नहीं है।\n\n`shop` = Shop" });
    return;
  }

  const lines = result.orders.slice(0, 5).map((order, index) => {
    const date = new Date(order.created_at).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${index + 1}. *${order.order_id}*\n   🗓 ${date}\n   💰 ₹${order.total}\n   📦 ${order.status}\n   💳 ${order.payment_status}`;
  });

  await sock.sendMessage(jid, {
    text:
      "📦 *MY ORDERS*\n\n" +
      lines.join("\n\n") +
      "\n\n`track ORDER-ID` = Track\n`details ORDER-ID` = Details\n`menu` = Main Menu",
  });
}

async function showOrder(sock, jid, orderId) {
  const result = await getOrder({
    wa_id: jid,
    phone: phoneFromJid(jid),
    display_name: getSession(jid).displayName,
    order_id: orderId,
  });
  const order = result.order;
  const lines = order.items.map((item) => {
    const weight = item.quantity_grams ? ` • ${item.quantity_grams} g` : "";
    return `• ${item.name}${weight} × ${item.quantity} = ₹${item.subtotal}`;
  });

  await sock.sendMessage(jid, {
    text:
      `📋 *ORDER ${order.order_id}*\n\n` +
      lines.join("\n") +
      `\n\nSubtotal: ₹${order.subtotal}` +
      `\nDelivery: ₹${order.delivery_charge}` +
      `\nTotal: ₹${order.total}` +
      `\n\nStatus: *${order.status}*` +
      `\nPayment: ${order.payment_status} (${order.payment_method})` +
      `\n\n📍 ${order.address}`,
  });
}

async function checkoutStart(sock, jid) {
  const customer = await getCustomer({
    wa_id: jid,
    phone: phoneFromJid(jid),
    display_name: getSession(jid).displayName,
  });
  const cart = await getCart({
    wa_id: jid,
    phone: phoneFromJid(jid),
    display_name: getSession(jid).displayName,
  });

  if (!cart.items.length) {
    await sock.sendMessage(jid, { text: "🛒 आपका cart खाली है। पहले product add करें।" });
    return;
  }

  const state = getSession(jid);
  state.step = "address";
  state.savedAddress = customer.address;

  if (customer.address) {
    state.step = "address_choice";
    await sock.sendMessage(jid, {
      text:
        "📍 *DELIVERY ADDRESS*\n\n" +
        `Saved address:\n${customer.address.address}, ${customer.address.city} - ${customer.address.pincode}\n\n` +
        "1️⃣ Use saved address\n" +
        "2️⃣ Enter new address",
    });
    return;
  }

  await sock.sendMessage(jid, {
    text:
      "📍 *DELIVERY ADDRESS*\n\n" +
      "अपना address एक message में भेजें:\n" +
      "House/Street, City, Pincode\n\n" +
      "Example: Main Road, Vaishali, 844114",
  });
}

async function finishCheckout(sock, jid, addressId, paymentMethod) {
  const result = await checkout({
    wa_id: jid,
    phone: phoneFromJid(jid),
    display_name: getSession(jid).displayName,
    address_id: addressId,
    payment_method: paymentMethod,
  });

  const state = getSession(jid);
  state.step = "main";

  if (paymentMethod === "online") {
    if (!result.payment_url) {
      await sock.sendMessage(jid, {
        text: `⚠️ Online payment अभी तैयार नहीं हो सका। Order ${result.order_id} बनाया गया है।\n\nआप COD के लिए support से संपर्क करें।`,
      });
      return;
    }
    await sock.sendMessage(jid, {
      text:
        `🧾 *ORDER CREATED*\n\n` +
        `Order ID: *${result.order_id}*\n` +
        `Total: *₹${result.total}*\n\n` +
        "💳 नीचे payment page खोलकर payment complete करें:\n" +
        result.payment_url +
        "\n\nPayment के बाद order status refresh हो जाएगा।",
    });
    return;
  }

  await sock.sendMessage(jid, {
    text:
      `✅ *ORDER CONFIRMED*\n\n` +
      `Order ID: *${result.order_id}*\n` +
      `Total: *₹${result.total}*\n` +
      "Payment: 💵 Cash on Delivery\n\n" +
      "📦 `orders` = My Orders\n" +
      `📍 `track ${result.order_id}` = Track Order`,
  });
}

async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us")) return;
  if (message.key.fromMe) return;

  const text = getText(message);
  if (!text) return;

  const displayName = message.pushName || "Customer";
  const state = getSession(jid, displayName);
  await customerPayload(jid, displayName);

  const lower = text.toLowerCase();

  try {
    if (["hi", "hello", "start", "/start", "menu", "home"].includes(lower)) {
      await sendMainMenu(sock, jid);
      return;
    }

    if (["shop", "1", "categories"].includes(lower) && ["main", "orders", "cart"].includes(state.step)) {
      await sendCategories(sock, jid);
      return;
    }

    if (lower === "cart" || lower === "2") {
      await showCart(sock, jid);
      return;
    }

    if (lower === "orders" || lower === "my orders" || lower === "3") {
      await showOrders(sock, jid);
      return;
    }

    if (lower === "checkout") {
      await checkoutStart(sock, jid);
      return;
    }

    if (lower === "contact" || lower === "5") {
      await sock.sendMessage(jid, {
        text: "📞 *CONTACT*\n\nOrder/help के लिए इसी WhatsApp chat में message भेजें।",
      });
      return;
    }

    if (lower === "back") {
      if (state.step === "product" || state.step === "weight" || state.step === "piece_quantity") {
        await sendProducts(sock, jid, state.category);
      } else {
        await sendMainMenu(sock, jid);
      }
      return;
    }

    if (lower.startsWith("track ")) {
      const orderId = text.slice(6).trim();
      const result = await getOrder({
        wa_id: jid,
        phone: phoneFromJid(jid),
        display_name: state.displayName,
        order_id: orderId,
      });
      await sock.sendMessage(jid, {
        text: `📍 *ORDER TRACKING*\n\nOrder: *${result.order.order_id}*\n\nCurrent status: *${result.order.status}*\n\nयह वही current status है जो Admin में set किया गया है।`,
      });
      return;
    }

    if (lower.startsWith("details ")) {
      await showOrder(sock, jid, text.slice(8).trim());
      return;
    }

    if (state.step === "category") {
      const index = Number.parseInt(text, 10) - 1;
      if (Number.isInteger(index) && state.categories?.[index]) {
        await sendProducts(sock, jid, state.categories[index]);
        return;
      }
    }

    if (state.step === "product") {
      const index = Number.parseInt(text, 10) - 1;
      if (Number.isInteger(index) && state.products?.[index]) {
        await showProduct(sock, jid, state.products[index]);
        return;
      }
    }

    if (state.step === "weight") {
      const weights = { "1": 250, "2": 500, "3": 750, "4": 1000 };
      const grams = weights[text];
      if (grams) {
        await addSelectedProduct(sock, jid, 1, grams);
        return;
      }
    }

    if (state.step === "piece_quantity") {
      const quantity = Number.parseInt(text, 10);
      if (Number.isInteger(quantity) && quantity > 0) {
        await addSelectedProduct(sock, jid, quantity, 0);
        return;
      }
    }

    if (state.step === "address_choice") {
      if (text === "1") {
        state.step = "payment";
        state.addressId = state.savedAddress.id;
        await sock.sendMessage(jid, {
          text: "💳 Payment method चुनें:\n\n1️⃣ Cash on Delivery\n2️⃣ Online Payment",
        });
        return;
      }
      if (text === "2") {
        state.step = "address";
        await sock.sendMessage(jid, {
          text: "📍 नया address भेजें: House/Street, City, Pincode",
        });
        return;
      }
    }

    if (state.step === "address") {
      const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length < 3 || !/^\d{5,6}$/.test(parts.at(-1))) {
        await sock.sendMessage(jid, {
          text: "❌ Format सही नहीं है।\n\nHouse/Street, City, Pincode",
        });
        return;
      }
      const pincode = parts.pop();
      const city = parts.pop();
      const address = parts.join(", ");
      const saved = await saveAddress({
        wa_id: jid,
        phone: phoneFromJid(jid),
        display_name: state.displayName,
        address,
        city,
        pincode,
      });
      state.addressId = saved.address_id;
      state.step = "payment";
      await sock.sendMessage(jid, {
        text: "✅ Address saved.\n\n💳 Payment method चुनें:\n\n1️⃣ Cash on Delivery\n2️⃣ Online Payment",
      });
      return;
    }

    if (state.step === "payment") {
      if (text === "1" || lower === "cod") {
        await finishCheckout(sock, jid, state.addressId, "cod");
        return;
      }
      if (text === "2" || lower === "online") {
        await finishCheckout(sock, jid, state.addressId, "online");
        return;
      }
    }

    await sock.sendMessage(jid, {
      text: "मैं समझ नहीं पाया। `menu` भेजें और main menu से option चुनें।",
    });
  } catch (error) {
    logger.error({ error, jid, text }, "Message handler failed");
    await sock.sendMessage(jid, {
      text: `⚠️ अभी request process नहीं हो सकी।\n\n${error.message || "Please try again."}`,
    });
  }
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu("Sweet & Snacks"),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 WhatsApp QR — scan from WhatsApp > Linked Devices > Link a Device\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ WhatsApp bot connected and ready.");
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("WhatsApp connection closed:", statusCode, "reconnect:", shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startWhatsApp, 3000);
      } else {
        console.log("Logged out. Remove the auth directory and pair again.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const message of messages) {
      await handleMessage(sock, message);
    }
  });
}

http
  .createServer((request, response) => {
    if (request.url === "/health" || request.url === "/") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "whatsapp-bot" }));
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  })
  .listen(PORT, () => console.log(`WhatsApp service health server listening on ${PORT}`));

startWhatsApp().catch((error) => {
  logger.error({ error }, "WhatsApp bot failed to start");
  process.exit(1);
});
