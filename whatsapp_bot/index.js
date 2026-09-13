import "dotenv/config";
import http from "node:http";
import { Boom } from "@hapi/boom";
import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion } from "@whiskeysockets/baileys";
import { Pool } from "pg";
import { usePostgresAuthState } from "./postgres_auth.js";
import P from "pino";
import qrcode from "qrcode-terminal";
import { addToCart, checkout, getCart, getCategories, getCustomer, getFavorites, getOrder, getOrders, getProduct, getProducts, removeCartItem, searchProducts, toggleFavorite, reorder, changeCartItem, clearCart, setLanguage } from "./api.js";

const PORT = Number(process.env.WHATSAPP_PORT || 3000);
const WHATSAPP_DATABASE_URL = (process.env.WHATSAPP_DATABASE_URL || "").trim();
const logger = P({ level: process.env.LOG_LEVEL || "info" });
const pool = WHATSAPP_DATABASE_URL ? new Pool({ connectionString: WHATSAPP_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;
const sessions = new Map();
const phone = (jid) => (jid || "").split("@")[0].replace(/\D/g, "").slice(-15);
const unwrap = (m) => { let x = m; for (let i = 0; i < 8; i++) { if (x?.ephemeralMessage?.message) x = x.ephemeralMessage.message; else if (x?.viewOnceMessage?.message) x = x.viewOnceMessage.message; else if (x?.viewOnceMessageV2?.message) x = x.viewOnceMessageV2.message; else if (x?.documentWithCaptionMessage?.message) x = x.documentWithCaptionMessage.message; else break; } return x || {}; };
const textOf = (m) => { const x = unwrap(m?.message); return String(x.conversation || x.extendedTextMessage?.text || x.imageMessage?.caption || x.videoMessage?.caption || x.documentMessage?.caption || x.buttonsResponseMessage?.selectedDisplayText || x.listResponseMessage?.title || x.interactiveResponseMessage?.body?.text || "").trim(); };
const actionOf = (m) => { const x = unwrap(m?.message); if (x.buttonsResponseMessage?.selectedButtonId) return x.buttonsResponseMessage.selectedButtonId; if (x.listResponseMessage?.singleSelectReply?.selectedRowId) return x.listResponseMessage.singleSelectReply.selectedRowId; const raw = x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson; if (raw) { try { return JSON.parse(raw)?.id || ""; } catch {} } return ""; };
const incomingLocation = (m) => unwrap(m?.message)?.locationMessage || null;
const incomingContact = (m) => unwrap(m?.message)?.contactMessage || null;
const state = (jid, name = "Customer") => { if (!sessions.has(jid)) sessions.set(jid, { step: "home", name, language: "hi" }); const s = sessions.get(jid); if (name) s.name = name; return s; };
const payload = (jid, name) => ({ wa_id: jid, phone: phone(jid), display_name: name });
const money = (v) => `₹${Number(v || 0).toFixed(2)}`;
const labelWeight = (g) => Number(g) >= 1000 && Number(g) % 1000 === 0 ? `${Number(g) / 1000} kg` : `${g} g`;
const greeting = /^(hi|hii|hiii|hello|hey|heyy|namaste|namaskar|start|\/start|menu|home|नमस्ते|नमस्कार)$/i;

async function buttons(sock, jid, text, items) {
  const clean = items.filter(Boolean).slice(0, 3);
  try { await sock.sendMessage(jid, { text, footer: "Sweet & Snacks", buttons: clean.map(x => ({ buttonId: x.id, buttonText: { displayText: x.text.slice(0, 20) }, type: 1 })), headerType: 1 }); }
  catch { await sock.sendMessage(jid, { text: `${text}\n\n${clean.map((x, i) => `${i + 1}. ${x.text}`).join("\n")}` }); }
}
async function list(sock, jid, text, rows, title = "Choose") {
  const clean = rows.filter(Boolean).slice(0, 10);
  try { await sock.sendMessage(jid, { title: "🍬 Sweet & Snacks", text, footer: "Sweet & Snacks", buttonText: title, sections: [{ title: "Options", rows: clean.map(x => ({ rowId: x.id, title: x.title.slice(0, 24), description: String(x.description || "").slice(0, 72) })) }] }); }
  catch { await sock.sendMessage(jid, { text: `${text}\n\n${clean.map((x, i) => `${i + 1}. ${x.title}`).join("\n")}` }); }
}
async function home(sock, jid) {
  const s = state(jid); s.step = "home"; s.product = null; s.waiting = false;
  await buttons(sock, jid, `🍬 *Sweet & Snacks*\n\nनमस्ते ${s.name}! ❤️\nFresh sweets & snacks delivered to your door.\n\nनीचे button से पूरा shopping करें — आपको menu type करने की जरूरत नहीं है.`, [{ id: "shop", text: "🛍 Shop" }, { id: "cart", text: "🛒 My Cart" }, { id: "orders", text: "📦 My Orders" }]);
  await buttons(sock, jid, "Quick actions", [{ id: "favorites", text: "❤️ Favorites" }, { id: "search", text: "🔎 Search" }, { id: "address", text: "📍 My Address" }]);
  await buttons(sock, jid, "More", [{ id: "language", text: "🌐 Language" }, { id: "help", text: "☎️ Help" }]);
}
async function language(sock, jid) { state(jid).step = "language"; return buttons(sock, jid, "🌐 *LANGUAGE / भाषा*\n\nभाषा चुनें:", [{ id: "language_hi", text: "🇮🇳 हिंदी" }, { id: "language_en", text: "🇬🇧 English" }]); }
async function categories(sock, jid) { const r = await getCategories(), s = state(jid); s.step = "category"; s.categories = r.categories; if (!r.categories.length) return sock.sendMessage(jid, { text: "📂 अभी कोई category उपलब्ध नहीं है।" }); await list(sock, jid, "🛍 *SHOP BY CATEGORY*\n\nअपनी पसंद की category चुनें:", r.categories.map(c => ({ id: `category_${c.id}`, title: `${c.emoji || "🍽️"} ${c.name}` })), "Choose Category"); await buttons(sock, jid, "Shop actions", [{ id: "search", text: "🔎 Search" }, { id: "cart", text: "🛒 Cart" }, { id: "home", text: "🏠 Home" }]); }
async function products(sock, jid, category) { const r = await getProducts(category.id), s = state(jid); s.step = "products"; s.category = category; s.products = r.products; if (!r.products.length) return buttons(sock, jid, "😔 इस category में अभी product उपलब्ध नहीं है।", [{ id: "categories", text: "⬅️ Categories" }, { id: "home", text: "🏠 Home" }]); await sock.sendMessage(jid, { text: `${category.emoji || "🍽️"} *${category.name.toUpperCase()}*\n\nProduct चुनें:` }); for (const p of r.products) { const caption = `🍬 *${p.name}*\n${p.description ? `${p.description}\n` : ""}💰 ${money(p.price)} / ${p.price_quantity_label}\n📦 ${p.stock_display}`; if (p.image_url) { try { await sock.sendMessage(jid, { image: { url: p.image_url }, caption }); } catch { await sock.sendMessage(jid, { text: caption }); } } else await sock.sendMessage(jid, { text: caption }); await buttons(sock, jid, `*${p.name}*`, [{ id: `product_${p.id}`, text: "🛍 Choose" }, { id: `favorite_${p.id}`, text: "❤️ Favorite" }]); } await buttons(sock, jid, "More options", [{ id: "cart", text: "🛒 Cart" }, { id: "favorites", text: "❤️ Favorites" }, { id: "categories", text: "⬅️ Categories" }]); }
async function product(sock, jid, p) { const s = state(jid); s.product = p; s.qty = Math.max(Number(s.qty || 1), 1); const f = await getFavorites(payload(jid, s.name)); s.favorite = f.products.some(x => x.id === p.id); const base = `🍬 *${p.name}*\n\n${p.description || "Freshly prepared and carefully packed."}\n\n💰 ${money(p.price)} / ${p.price_quantity_label}\n📦 ${p.stock_display}\n❤️ Favorite: ${s.favorite ? "Yes" : "No"}`; if (p.is_weight_based) { s.step = "weight"; s.weight = Number(s.weight || (p.weight_options?.[0] || 250)); return list(sock, jid, `${base}\n\n⚖️ Weight चुनें:`, (p.weight_options || [250, 500, 750, 1000]).map(g => ({ id: `weight_${p.id}_${g}`, title: `${s.weight === g ? "✅ " : ""}${labelWeight(g)}` })), "Choose Weight"); } s.step = "product"; return productActions(sock, jid, p, base); }
async function productActions(sock, jid, p, base) { const s = state(jid); const qty = Math.max(Number(s.qty || 1), 1); await sock.sendMessage(jid, { text: `${base}\n\n🔢 Quantity: *${qty}*\n🧾 Total: *${money(Number(p.price) * qty)}*` }); await buttons(sock, jid, "Quantity", [{ id: `qtydec_${p.id}`, text: "➖" }, { id: `qty_${p.id}`, text: `Qty ${qty}` }, { id: `qtyinc_${p.id}`, text: "➕" }]); await buttons(sock, jid, "Order", [{ id: `addcart_${p.id}`, text: "🛒 Add to Cart" }, { id: `buynow_${p.id}`, text: "⚡ Buy Now" }]); await buttons(sock, jid, "Product", [{ id: `favorite_${p.id}`, text: s.favorite ? "💔 Remove Favorite" : "❤️ Favorite" }, { id: "cart", text: "🛒 Cart" }, { id: `category_${p.category_id}`, text: "⬅️ Back" }]); }
async function addProduct(sock, jid, quantity = 1, grams = 0, buyNow = false) { const s = state(jid), p = s.product; if (!p) return home(sock, jid); await addToCart({ ...payload(jid, s.name), product_id: p.id, quantity, quantity_grams: grams }); if (buyNow) return checkoutStart(sock, jid); s.product = null; s.step = "home"; return buttons(sock, jid, `✅ *${p.name}* cart में add हो गया।`, [{ id: "cart", text: "🛒 View Cart" }, { id: "shop", text: "🛍 Continue Shopping" }, { id: "home", text: "🏠 Home" }]); }
async function cart(sock, jid) { const s = state(jid), r = await getCart(payload(jid, s.name)); s.step = "cart"; if (!r.items.length) return buttons(sock, jid, "🛒 *MY CART*\n\nCart खाली है।", [{ id: "shop", text: "🛍 Shop Now" }, { id: "home", text: "🏠 Home" }]); const lines = ["🛒 *MY CART*", ""]; for (const x of r.items) lines.push(`🍬 *${x.name}*\n${x.quantity_grams ? `${x.quantity} × ${labelWeight(x.quantity_grams)}` : `${x.quantity} × pc`} = *${money(x.subtotal)}*`); lines.push(`\n💰 *Subtotal: ${money(r.subtotal)}*`); await sock.sendMessage(jid, { text: lines.join("\n") }); for (const x of r.items) await buttons(sock, jid, `${x.name} • Qty ${x.quantity}`, [{ id: `cartdec_${x.id}`, text: "➖" }, { id: `cartitem_${x.product_id}`, text: "View" }, { id: `cartinc_${x.id}`, text: "➕" }]); await buttons(sock, jid, "Cart actions", [{ id: "checkout", text: "💳 Checkout" }, { id: "shop", text: "🛍 Continue" }, { id: "clear_cart", text: "🧹 Clear Cart" }]); }
async function addresses(sock, jid) { const s = state(jid); const c = await getCustomer(payload(jid, s.name)); s.step = "address_choice"; if (!c.address) return buttons(sock, jid, "📍 *MY DELIVERY ADDRESS*\n\nNo saved address yet.", [{ id: "new_address", text: "➕ Add Address" }, { id: "home", text: "🏠 Home" }]); s.addressId = c.address.id; return buttons(sock, jid, `📍 *MY DELIVERY ADDRESS*\n\n${c.address.address}, ${c.address.city} - ${c.address.pincode}`, [{ id: "use_address", text: "✅ Use Saved" }, { id: "new_address", text: "➕ Change Address" }, { id: "home", text: "🏠 Home" }]); }
async function checkoutStart(sock, jid) { const s = state(jid), c = await getCustomer(payload(jid, s.name)), r = await getCart(payload(jid, s.name)); if (!r.items.length) return cart(sock, jid); if (c.address) { s.addressId = c.address.id; return buttons(sock, jid, `📍 *DELIVERY ADDRESS*\n\n${c.address.address}, ${c.address.city} - ${c.address.pincode}`, [{ id: "use_address", text: "✅ Use Saved" }, { id: "new_address", text: "📍 New Address" }, { id: "cart", text: "🛒 Cart" }]); } return addresses(sock, jid); }
async function payment(sock, jid) { state(jid).step = "payment"; return buttons(sock, jid, "💳 *CHECKOUT*\n\nPayment method चुनें:", [{ id: "pay_cod", text: "💵 Cash on Delivery" }, { id: "pay_online", text: "💳 Online Payment" }, { id: "address", text: "📍 Address" }]); }
async function createOrder(sock, jid, method) { const s = state(jid); const r = await checkout({ ...payload(jid, s.name), address_id: s.addressId, payment_method: method }); s.step = "home"; if (method === "online" && r.payment_url) return buttons(sock, jid, `🧾 *ORDER CREATED*\n\nOrder ID: *${r.order_id}*\nTotal: *${money(r.total)}*\n\n💳 Payment link:\n${r.payment_url}`, [{ id: `details_${r.order_id}`, text: "📋 Details" }, { id: "orders", text: "📦 My Orders" }, { id: "home", text: "🏠 Home" }]); if (method === "online") return buttons(sock, jid, `⚠️ Online payment could not be prepared.\nOrder ID: ${r.order_id}`, [{ id: "orders", text: "📦 Orders" }, { id: "home", text: "🏠 Home" }]); return buttons(sock, jid, `🎉 *ORDER CONFIRMED*\n\n🆔 *${r.order_id}*\n💵 Cash on Delivery\n💰 *${money(r.total)}*`, [{ id: `track_${r.order_id}`, text: "📍 Track Order" }, { id: "orders", text: "📦 My Orders" }, { id: "home", text: "🏠 Home" }]); }
async function orders(sock, jid) { const s = state(jid), r = await getOrders(payload(jid, s.name)); s.step = "orders"; if (!r.orders.length) return buttons(sock, jid, "📦 अभी कोई order नहीं है।", [{ id: "shop", text: "🛍 Shop Now" }, { id: "home", text: "🏠 Home" }]); return list(sock, jid, "📦 *MY ORDERS*\n\nRecent orders:", r.orders.slice(0, 10).map(o => ({ id: `details_${o.order_id}`, title: o.order_id, description: `${money(o.total)} • ${o.status}` })), "Choose Order"); }
async function details(sock, jid, id) { const s = state(jid), r = await getOrder({ ...payload(jid, s.name), order_id: id }), o = r.order; const items = o.items.map(i => `• ${i.name}${i.quantity_grams ? ` • ${labelWeight(i.quantity_grams)}` : ""} × ${i.quantity} = ${money(i.subtotal)}`).join("\n"); await sock.sendMessage(jid, { text: `📋 *ORDER ${o.order_id}*\n\n${items}\n\nSubtotal: ${money(o.subtotal)}\nDelivery: ${money(o.delivery_charge)}\nTotal: *${money(o.total)}*\n\nStatus: *${o.status}*\nPayment: ${o.payment_status}\n📍 ${o.address}` }); return buttons(sock, jid, "Order actions", [{ id: `track_${id}`, text: "📍 Track" }, { id: `reorder_${id}`, text: "🔄 Reorder" }, { id: "orders", text: "📦 Orders" }]); }
async function track(sock, jid, id) { const r = await getOrder({ ...payload(jid, state(jid).name), order_id: id }); return buttons(sock, jid, `📍 *ORDER TRACKING*\n\nOrder: *${r.order.order_id}*\nCurrent status: *${r.order.status}*\nPayment: ${r.order.payment_status}`, [{ id: `details_${id}`, text: "📋 Details" }, { id: "orders", text: "📦 Orders" }, { id: "home", text: "🏠 Home" }]); }
async function favorites(sock, jid) { const s = state(jid), r = await getFavorites(payload(jid, s.name)); s.step = "favorites"; if (!r.products.length) return buttons(sock, jid, "❤️ *FAVORITES*\n\nअभी कोई favorite product नहीं है।", [{ id: "shop", text: "🛍 Shop" }, { id: "home", text: "🏠 Home" }]); return list(sock, jid, "❤️ *FAVORITES*\n\nProduct चुनें:", r.products.map(p => ({ id: `product_${p.id}`, title: p.name, description: `${money(p.price)} • ${p.price_quantity_label}` })), "Choose Product"); }
async function search(sock, jid, q = "") { const s = state(jid); s.step = "search"; if (!q) { s.waiting = true; return buttons(sock, jid, "🔎 *SEARCH*\n\nProduct search करने के लिए उसका नाम भेजें।", [{ id: "shop", text: "🛍 Shop" }, { id: "home", text: "🏠 Home" }]); } const r = await searchProducts(q); if (!r.products.length) return buttons(sock, jid, `🔎 “${q}” के लिए कोई product नहीं मिला।`, [{ id: "search", text: "🔎 Search Again" }, { id: "shop", text: "🛍 Shop" }, { id: "home", text: "🏠 Home" }]); return list(sock, jid, `🔎 *SEARCH RESULTS*\n\n“${q}”`, r.products.map(p => ({ id: `product_${p.id}`, title: p.name, description: `${money(p.price)} • ${p.price_quantity_label}` })), "Choose Product"); }
async function handle(sock, m) {
  const jid = m?.key?.remoteJid; if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us") || m.key.fromMe) return;
  const text = textOf(m), action = actionOf(m), location = incomingLocation(m), contact = incomingContact(m); if (!text && !action && !location && !contact) return;
  const name = m.pushName || "Customer", s = state(jid, name), lower = text.toLowerCase().trim();
  try {
    await getCustomer(payload(jid, name));
    if (contact) { await sock.sendMessage(jid, { text: "✅ Mobile number received. Your WhatsApp number is linked to your customer profile." }); return addresses(sock, jid); }
    if (location) { s.location = { latitude: location.degreesLatitude, longitude: location.degreesLongitude }; return buttons(sock, jid, "📍 Location received.\n\nअब आपका saved address use करें या address details भेजें।", [{ id: "address", text: "📍 My Address" }, { id: "home", text: "🏠 Home" }]); }
    if (action === "home" || action === "main_menu" || greeting.test(lower)) return home(sock, jid);
    if (action === "language") return language(sock, jid);
    if (action === "language_hi" || action === "language_en") { const lang = action.endsWith("en") ? "en" : "hi"; s.language = lang; await setLanguage({ ...payload(jid, name), language: lang }); return home(sock, jid); }
    if (action === "shop" || action === "categories" || lower === "shop" || lower === "categories") return categories(sock, jid);
    if (action === "cart" || lower === "cart") return cart(sock, jid);
    if (action === "orders" || lower === "orders" || lower === "my orders") return orders(sock, jid);
    if (action === "favorites" || lower === "favorites") return favorites(sock, jid);
    if (action === "search" || lower === "search") return search(sock, jid);
    if (action === "address") return addresses(sock, jid);
    if (action === "help" || lower === "help") return buttons(sock, jid, "☎️ *HELP*\n\nआप buttons से Shop → Product → Cart → Checkout → Payment → Orders कर सकते हैं।", [{ id: "shop", text: "🛍 Shop" }, { id: "orders", text: "📦 Orders" }, { id: "home", text: "🏠 Home" }]);
    if (action === "use_address") return payment(sock, jid);
    if (action === "new_address") return addresses(sock, jid);
    if (action === "checkout") return checkoutStart(sock, jid);
    if (action === "clear_cart") { await clearCart(payload(jid, name)); return cart(sock, jid); }
    if (action.startsWith("category_")) { const c = s.categories?.find(x => x.id === Number(action.slice(9))) || (await getCategories()).categories.find(x => x.id === Number(action.slice(9))); return c ? products(sock, jid, c) : categories(sock, jid); }
    if (action.startsWith("product_") || action.startsWith("cartitem_")) { const id = Number(action.split("_")[1]); const r = await getProduct(id); return product(sock, jid, r.product); }
    if (action.startsWith("favorite_")) { const id = Number(action.slice(9)); const r = await toggleFavorite({ ...payload(jid, name), product_id: id }); s.favorite = r.favorite; return buttons(sock, jid, r.message, [{ id: `product_${id}`, text: "🛍 Product" }, { id: "favorites", text: "❤️ Favorites" }, { id: "shop", text: "🛍 Shop" }]); }
    if (action.startsWith("weight_")) { const parts = action.split("_"); s.weight = Number(parts[2]); const r = await getProduct(Number(parts[1])); return product(sock, jid, r.product); }
    if (action.startsWith("qtyinc_")) { s.qty = Math.min(Number(s.qty || 1) + 1, 99); return productActions(sock, jid, s.product, `🍬 *${s.product.name}*\n\n${s.product.description || "Freshly prepared and carefully packed."}\n\n💰 ${money(s.product.price)} / ${s.product.price_quantity_label}\n📦 ${s.product.stock_display}`); }
    if (action.startsWith("qtydec_")) { s.qty = Math.max(Number(s.qty || 1) - 1, 1); return productActions(sock, jid, s.product, `🍬 *${s.product.name}*\n\n${s.product.description || "Freshly prepared and carefully packed."}\n\n💰 ${money(s.product.price)} / ${s.product.price_quantity_label}\n📦 ${s.product.stock_display}`); }
    if (action.startsWith("addcart_")) return addProduct(sock, jid, Number(s.qty || 1), s.product?.is_weight_based ? Number(s.weight || 250) : 0, false);
    if (action.startsWith("buynow_")) return addProduct(sock, jid, Number(s.qty || 1), s.product?.is_weight_based ? Number(s.weight || 250) : 0, true);
    if (action.startsWith("cartinc_")) { await changeCartItem({ ...payload(jid, name), cart_item_id: Number(action.slice(8)), delta: 1 }); return cart(sock, jid); }
    if (action.startsWith("cartdec_")) { await changeCartItem({ ...payload(jid, name), cart_item_id: Number(action.slice(8)), delta: -1 }); return cart(sock, jid); }
    if (action.startsWith("cartremove_")) { await removeCartItem({ ...payload(jid, name), cart_item_id: Number(action.slice(11)) }); return cart(sock, jid); }
    if (action === "pay_cod") return createOrder(sock, jid, "cod");
    if (action === "pay_online") return createOrder(sock, jid, "online");
    if (action.startsWith("details_")) return details(sock, jid, action.slice(8));
    if (action.startsWith("track_")) return track(sock, jid, action.slice(6));
    if (action.startsWith("reorder_")) { const r = await reorder({ ...payload(jid, name), order_id: action.slice(8) }); return buttons(sock, jid, r.message, [{ id: "cart", text: "🛒 Cart" }, { id: "checkout", text: "💳 Checkout" }, { id: "home", text: "🏠 Home" }]); }
    if (s.step === "search" && s.waiting) { s.waiting = false; return search(sock, jid, text); }
    return buttons(sock, jid, "मैंने आपका message समझ लिया। नीचे buttons से आगे बढ़ें।", [{ id: "shop", text: "🛍 Shop" }, { id: "cart", text: "🛒 Cart" }, { id: "home", text: "🏠 Home" }]);
  } catch (error) { logger.error({ error, jid, text, action }, "WhatsApp handler failed"); await sock.sendMessage(jid, { text: `⚠️ Request process नहीं हो सकी.\n\n${error.message || "Please try again."}` }).catch(() => {}); }
}

async function connect() {
  if (!pool) throw new Error("WHATSAPP_DATABASE_URL is required for WhatsApp session persistence on Render Free.");
  const auth = await usePostgresAuthState(pool, "sweet-snacks-whatsapp");
  const sock = makeWASocket({ auth: auth.state, browser: Browsers.ubuntu("Sweet & Snacks"), logger, markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on("creds.update", auth.saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => { if (qr) qrcode.generate(qr, { small: true }); if (connection === "open") logger.info("✅ WhatsApp bot connected."); if (connection === "close") { const code = new Boom(lastDisconnect?.error)?.output?.statusCode; if (code !== DisconnectReason.loggedOut) setTimeout(() => connect().catch(e => logger.error({ e }, "Reconnect failed")), 3000); else { await auth.deleteSession(); logger.error("WhatsApp logged out. Stored session was cleared; scan a new QR."); } } });
  sock.ev.on("messages.upsert", async ({ messages }) => { for (const m of messages) await handle(sock, m); });
}

http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, service: "whatsapp-bot" })); }).listen(PORT, "0.0.0.0", () => logger.info(`WhatsApp bot HTTP server listening on ${PORT}`));
connect().catch(error => { logger.error({ error }, "WhatsApp bot startup failed"); process.exit(1); });
