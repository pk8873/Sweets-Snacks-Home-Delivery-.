import "dotenv/config";
import http from "node:http";
import { Boom } from "@hapi/boom";
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import P from "pino";
import qrcode from "qrcode-terminal";
import { addToCart, checkout, getCart, getCategories, getCustomer, getOrder, getOrders, getProducts, saveAddress } from "./api.js";

const PORT = Number(process.env.PORT || 3000);
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || "./auth_info";
const logger = P({ level: process.env.LOG_LEVEL || "info" });
const state = new Map();
const phone = (jid) => (jid || "").split("@")[0].replace(/\D/g, "").slice(-15);
const textOf = (m) => (m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || "").trim();
const session = (jid, name = "Customer") => { if (!state.has(jid)) state.set(jid, { step: "main", name }); const s = state.get(jid); if (name) s.name = name; return s; };
const customer = (jid, name) => getCustomer({ wa_id: jid, phone: phone(jid), display_name: name });

async function menu(sock, jid) {
  const s = session(jid); s.step = "main";
  await sock.sendMessage(jid, { text: "🍬 *Sweet & Snacks Home Delivery*\n\nनमस्ते! आपका स्वागत है।\n\n1️⃣ 🛍️ Shop\n2️⃣ 🛒 Cart\n3️⃣ 📦 My Orders\n4️⃣ 📍 Track Order\n5️⃣ 📞 Contact\n\n`menu` = Main Menu" });
}

async function categories(sock, jid) {
  const r = await getCategories(); const s = session(jid); s.step = "category"; s.categories = r.categories;
  await sock.sendMessage(jid, { text: r.categories.length ? "🛍️ *SHOP*\n\n" + r.categories.map((c, i) => `${i + 1}️⃣ ${c.emoji} ${c.name}`).join("\n") : "😔 अभी कोई category उपलब्ध नहीं है।" });
}

async function products(sock, jid, category) {
  const r = await getProducts(category.id); const s = session(jid); s.step = "product"; s.category = category; s.products = r.products;
  if (!r.products.length) return sock.sendMessage(jid, { text: "😔 इस category में अभी product उपलब्ध नहीं है।" });
  await sock.sendMessage(jid, { text: `${category.emoji} *${category.name.toUpperCase()}*\n\nProduct number भेजें।` });
  for (let i = 0; i < r.products.length; i++) {
    const p = r.products[i]; const caption = `${i + 1}. *${p.name}*\n${p.description ? `${p.description}\n` : ""}💰 ₹${p.price} / ${p.price_quantity_label}\n📦 ${p.stock_display}\n\nNumber भेजें।`;
    if (p.image_url) { try { await sock.sendMessage(jid, { image: { url: p.image_url }, caption }); continue; } catch (e) { logger.warn({ e, id: p.id }, "Image send failed"); } }
    await sock.sendMessage(jid, { text: caption });
  }
}

async function selectProduct(sock, jid, product) {
  const s = session(jid); s.product = product;
  if (product.is_weight_based) { s.step = "weight"; return sock.sendMessage(jid, { text: `🍬 *${product.name}*\n\n₹${product.price} / ${product.price_quantity_label}\n\nWeight चुनें:\n1️⃣ 250 g\n2️⃣ 500 g\n3️⃣ 750 g\n4️⃣ 1 kg\n\n\`back\` = Products` }); }
  s.step = "pieces"; await sock.sendMessage(jid, { text: `🥟 *${product.name}*\n\n₹${product.price} / piece\n📦 ${product.stock} available\n\nकितने pieces चाहिए?` });
}

async function addProduct(sock, jid, qty, grams = 0) {
  const s = session(jid); const p = s.product; if (!p) return;
  await addToCart({ wa_id: jid, phone: phone(jid), display_name: s.name, product_id: p.id, quantity: qty, quantity_grams: grams });
  s.step = "main"; s.product = null;
  await sock.sendMessage(jid, { text: `✅ *${p.name}* cart में add हो गया।\n\n🛒 \`cart\`\n🛍️ \`shop\`` });
}

async function cart(sock, jid) {
  const r = await getCart({ wa_id: jid, phone: phone(jid), display_name: session(jid).name }); session(jid).step = "cart";
  if (!r.items.length) return sock.sendMessage(jid, { text: "🛒 *CART*\n\nCart खाली है।\n\n`shop` = Shopping" });
  const lines = r.items.map((x, i) => `${i + 1}. ${x.name}${x.quantity_grams ? ` • ${x.quantity_grams} g` : ""}\n   Qty: ${x.quantity} • ₹${x.subtotal}`);
  await sock.sendMessage(jid, { text: "🛒 *YOUR CART*\n\n" + lines.join("\n\n") + `\n\n━━━━━━━━━━━━\nSubtotal: ₹${r.subtotal}\nItems: ${r.total_items}\n\n` + "`checkout` = Checkout\n`shop` = Continue Shopping\n`menu` = Main Menu" });
}

async function orders(sock, jid) {
  const r = await getOrders({ wa_id: jid, phone: phone(jid), display_name: session(jid).name }); session(jid).step = "orders";
  if (!r.orders.length) return sock.sendMessage(jid, { text: "📦 अभी कोई order नहीं है।\n\n`shop` = Shop" });
  const lines = r.orders.slice(0, 5).map((o, i) => `${i + 1}. *${o.order_id}*\n   🗓 ${new Date(o.created_at).toLocaleString("en-IN")}\n   💰 ₹${o.total}\n   📦 ${o.status}\n   💳 ${o.payment_status}`);
  await sock.sendMessage(jid, { text: "📦 *MY ORDERS*\n\n" + lines.join("\n\n") + "\n\n`track ORDER-ID`\n`details ORDER-ID`\n`menu`" });
}

async function details(sock, jid, orderId) {
  const r = await getOrder({ wa_id: jid, phone: phone(jid), display_name: session(jid).name, order_id: orderId }); const o = r.order;
  const items = o.items.map((i) => `• ${i.name}${i.quantity_grams ? ` • ${i.quantity_grams} g` : ""} × ${i.quantity} = ₹${i.subtotal}`).join("\n");
  await sock.sendMessage(jid, { text: `📋 *ORDER ${o.order_id}*\n\n${items}\n\nSubtotal: ₹${o.subtotal}\nDelivery: ₹${o.delivery_charge}\nTotal: ₹${o.total}\n\nStatus: *${o.status}*\nPayment: ${o.payment_status}\n\n📍 ${o.address}` });
}

async function beginCheckout(sock, jid) {
  const s = session(jid); const c = await customer(jid, s.name); const r = await getCart({ wa_id: jid, phone: phone(jid), display_name: s.name });
  if (!r.items.length) return sock.sendMessage(jid, { text: "🛒 Cart खाली है। पहले product add करें।" });
  s.savedAddress = c.address;
  if (c.address) { s.step = "address_choice"; s.addressId = c.address.id; return sock.sendMessage(jid, { text: `📍 *DELIVERY ADDRESS*\n\n${c.address.address}, ${c.address.city} - ${c.address.pincode}\n\n1️⃣ Use saved address\n2️⃣ New address` }); }
  s.step = "address"; await sock.sendMessage(jid, { text: "📍 Address भेजें:\nHouse/Street, City, Pincode" });
}

async function payment(sock, jid) { session(jid).step = "payment"; await sock.sendMessage(jid, { text: "💳 Payment method चुनें:\n\n1️⃣ Cash on Delivery\n2️⃣ Online Payment" }); }

async function createOrder(sock, jid, method) {
  const s = session(jid); const r = await checkout({ wa_id: jid, phone: phone(jid), display_name: s.name, address_id: s.addressId, payment_method: method }); s.step = "main";
  if (method === "online" && r.payment_url) return sock.sendMessage(jid, { text: `🧾 *ORDER CREATED*\n\nOrder ID: *${r.order_id}*\nTotal: *₹${r.total}*\n\n💳 Payment:\n${r.payment_url}` });
  await sock.sendMessage(jid, { text: `✅ *ORDER CONFIRMED*\n\nOrder ID: *${r.order_id}*\nTotal: *₹${r.total}*\nPayment: 💵 Cash on Delivery\n\n📦 \`orders\`\n📍 \`track ${r.order_id}\`` });
}

async function handle(sock, m) {
  const jid = m.key.remoteJid; if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us") || m.key.fromMe) return;
  const text = textOf(m); if (!text) return; const name = m.pushName || "Customer"; const s = session(jid, name); const lower = text.toLowerCase(); await customer(jid, name);
  try {
    if (["hi", "hello", "start", "/start", "menu", "home"].includes(lower)) return menu(sock, jid);
    if (["shop", "1", "categories"].includes(lower)) return categories(sock, jid);
    if (lower === "cart" || lower === "2") return cart(sock, jid);
    if (lower === "orders" || lower === "my orders" || lower === "3") return orders(sock, jid);
    if (lower === "checkout") return beginCheckout(sock, jid);
    if (lower === "contact" || lower === "5") return sock.sendMessage(jid, { text: "📞 *CONTACT*\n\nOrder/help के लिए इसी WhatsApp chat में message भेजें।" });
    if (lower === "back") return s.category ? products(sock, jid, s.category) : menu(sock, jid);
    if (lower.startsWith("track ")) { const r = await getOrder({ wa_id: jid, phone: phone(jid), display_name: name, order_id: text.slice(6).trim() }); return sock.sendMessage(jid, { text: `📍 *ORDER TRACKING*\n\nOrder: *${r.order.order_id}*\nCurrent status: *${r.order.status}*\n\nयह current Admin status है।` }); }
    if (lower.startsWith("details ")) return details(sock, jid, text.slice(8).trim());
    if (s.step === "category") { const i = Number(text) - 1; if (s.categories?.[i]) return products(sock, jid, s.categories[i]); }
    if (s.step === "product") { const i = Number(text) - 1; if (s.products?.[i]) return selectProduct(sock, jid, s.products[i]); }
    if (s.step === "weight") { const grams = ({ "1": 250, "2": 500, "3": 750, "4": 1000 })[text]; if (grams) return addProduct(sock, jid, 1, grams); }
    if (s.step === "pieces") { const qty = Number(text); if (Number.isInteger(qty) && qty > 0) return addProduct(sock, jid, qty); }
    if (s.step === "address_choice") { if (text === "1") return payment(sock, jid); if (text === "2") { s.step = "address"; return sock.sendMessage(jid, { text: "📍 नया address भेजें: House/Street, City, Pincode" }); } }
    if (s.step === "address") {
      const parts = text.split(",").map((x) => x.trim()).filter(Boolean); if (parts.length < 3 || !/^\d{5,6}$/.test(parts.at(-1))) return sock.sendMessage(jid, { text: "❌ Format: House/Street, City, Pincode" });
      const pincode = parts.pop(); const city = parts.pop(); const address = parts.join(", "); const r = await saveAddress({ wa_id: jid, phone: phone(jid), display_name: name, address, city, pincode }); s.addressId = r.address_id; return payment(sock, jid);
    }
    if (s.step === "payment") { if (text === "1" || lower === "cod") return createOrder(sock, jid, "cod"); if (text === "2" || lower === "online") return createOrder(sock, jid, "online"); }
    await sock.sendMessage(jid, { text: "मैं समझ नहीं पाया। `menu` भेजें।" });
  } catch (error) { logger.error({ error, jid }, "WhatsApp handler failed"); await sock.sendMessage(jid, { text: `⚠️ Request process नहीं हो सकी।\n\n${error.message || "Please try again."}` }); }
}

async function connect() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({ auth: authState, browser: Browsers.ubuntu("Sweet & Snacks"), logger, markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.log("📱 Scan: WhatsApp > Linked Devices > Link a Device"); qrcode.generate(qr, { small: true }); }
    if (connection === "open") console.log("✅ WhatsApp bot connected.");
    if (connection === "close") { const code = new Boom(lastDisconnect?.error)?.output?.statusCode; if (code !== DisconnectReason.loggedOut) setTimeout(connect, 3000); else console.log("❌ Logged out. Delete auth_info and pair again."); }
  });
  sock.ev.on("messages.upsert", async ({ messages }) => { for (const m of messages) await handle(sock, m); });
}

http.createServer((req, res) => { if (req.url === "/" || req.url === "/health") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ ok: true, service: "whatsapp-bot" })); } res.writeHead(404); res.end("Not found"); }).listen(PORT, () => console.log(`WhatsApp health server listening on ${PORT}`));
connect().catch((error) => { logger.error({ error }, "WhatsApp startup failed"); process.exit(1); });
