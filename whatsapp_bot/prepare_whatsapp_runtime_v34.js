import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V34";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V34 already applied; nothing to do.");
  process.exit(0);
}

const handleStart = source.indexOf("async function handle(sock, m)");
if (handleStart < 0) throw new Error("V34 could not locate WhatsApp message handler.");
const connectStart = source.indexOf("async function connect()", handleStart);
if (connectStart < 0) throw new Error("V34 could not locate WhatsApp connect function.");

const replacement = String.raw`async function handle(sock, m) {
  const jid = m?.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us") || m?.key?.fromMe) return;

  // IMPORTANT: keep this variable name unique. Older runtime patches created
  // a temporal-dead-zone collision around a variable named 'text'.
  let incomingText = "";
  let action = "";
  let location = null;
  let contact = null;

  try {
    incomingText = String(textOf(m) || "").trim();
    action = String(actionOf(m) || "").trim();
    location = incomingLocation(m);
    contact = incomingContact(m);

    logger.info({
      event: "whatsapp.incoming.v34",
      remote_jid: jid,
      from_me: Boolean(m?.key?.fromMe),
      message_type: Object.keys(unwrap(m?.message) || {}),
      incoming_text: incomingText,
      action,
      has_location: Boolean(location),
      has_contact: Boolean(contact)
    }, "WhatsApp V34 message parsed");

    if (!incomingText && !action && !location && !contact) return;

    const name = m?.pushName || "Customer";
    const s = state(jid, name);
    const lower = incomingText.toLowerCase().trim();

    await getCustomer(payload(jid, name));

    if (contact) {
      await sock.sendMessage(jid, { text: "✅ Mobile number received. Your WhatsApp number is linked to your customer profile." });
      return addresses(sock, jid);
    }

    if (location) {
      s.location = { latitude: location.degreesLatitude, longitude: location.degreesLongitude };
      return buttons(sock, jid, "📍 Location received.\n\nअब आपका saved address use करें या address details भेजें।", [
        { id: "address", text: "📍 My Address" },
        { id: "home", text: "🏠 Home" }
      ]);
    }

    if (action === "home" || action === "main_menu" || greeting.test(lower)) return home(sock, jid);
    if (action === "language") return language(sock, jid);
    if (action === "language_hi" || action === "language_en") {
      const lang = action.endsWith("en") ? "en" : "hi";
      s.language = lang;
      await setLanguage({ ...payload(jid, name), language: lang });
      return home(sock, jid);
    }

    if (action === "shop" || action === "categories" || lower === "shop" || lower === "categories") return categories(sock, jid);
    if (action === "cart" || lower === "cart") return cart(sock, jid);
    if (action === "orders" || lower === "orders" || lower === "my orders") return orders(sock, jid);
    if (action === "favorites" || lower === "favorites") return favorites(sock, jid);
    if (action === "search" || lower === "search") return search(sock, jid);
    if (action === "address") return addresses(sock, jid);
    if (action === "help" || lower === "help") {
      return buttons(sock, jid, "☎️ *HELP*\n\nआप buttons से Shop → Product → Cart → Checkout → Payment → Orders कर सकते हैं।", [
        { id: "shop", text: "🛍 Shop" },
        { id: "orders", text: "📦 Orders" },
        { id: "home", text: "🏠 Home" }
      ]);
    }

    // Address flow.
    if (!action && s.step === "address_line" && incomingText) {
      s.addressText = incomingText.slice(0, 500);
      s.step = "address_city";
      return sock.sendMessage(jid, { text: "🏙️ *Step 2/3 — City*\n\nअब अपना शहर लिखें।\n\nउदाहरण: Bhopal" });
    }
    if (!action && s.step === "address_city" && incomingText) {
      s.addressCity = incomingText.slice(0, 100);
      s.step = "address_pincode";
      return sock.sendMessage(jid, { text: "📮 *Step 3/3 — PIN Code*\n\nअब 6 digit PIN code लिखें।\n\nउदाहरण: 462001" });
    }
    if (!action && s.step === "address_pincode" && incomingText) {
      const pin = incomingText.replace(/\D/g, "").slice(0, 6);
      if (pin.length !== 6) return sock.sendMessage(jid, { text: "⚠️ PIN code 6 digit का होना चाहिए।\n\nकृपया फिर से 6 digit PIN code भेजें।" });
      await saveAddress({ ...payload(jid, s.name), address: s.addressText, city: s.addressCity, pincode: pin });
      s.addressText = "";
      s.addressCity = "";
      s.step = "address_choice";
      await sock.sendMessage(jid, { text: "✅ *Address saved successfully!*\n\nअब यह address अगली बार automatically use होगा।" });
      return addresses(sock, jid);
    }
    if (action === "new_address") {
      s.step = "address_line";
      s.addressText = "";
      s.addressCity = "";
      return sock.sendMessage(jid, { text: "📍 *Step 1/3 — Delivery Address*\n\nअपना House No., Street, Mohalla/Society या Landmark एक message में लिखें।\n\nउदाहरण: House 24, Main Road, Goraul, Near Market" });
    }
    if (action === "use_address") return payment(sock, jid);
    if (action === "checkout") return checkoutStart(sock, jid);
    if (action === "clear_cart") {
      await clearCart(payload(jid, name));
      return cart(sock, jid);
    }

    // Category/product selection.
    if (action.startsWith("category_")) {
      const id = Number(action.slice(9));
      const listResult = await getCategories();
      const category = s.categories?.find(x => Number(x.id) === id) || listResult.categories.find(x => Number(x.id) === id);
      return category ? products(sock, jid, category) : categories(sock, jid);
    }
    if (action.startsWith("product_") || action.startsWith("cartitem_")) {
      const id = Number(action.split("_")[1]);
      const r = await getProduct(id);
      return r.product ? product(sock, jid, r.product) : home(sock, jid);
    }
    if (action.startsWith("favorite_")) {
      const id = Number(action.slice(9));
      const r = await toggleFavorite({ ...payload(jid, name), product_id: id });
      s.favorite = r.favorite;
      return buttons(sock, jid, r.message, [
        { id: `product_${id}`, text: "🛍 Product" },
        { id: "favorites", text: "❤️ Favorites" },
        { id: "shop", text: "🛍 Shop" }
      ]);
    }
    if (action.startsWith("weight_")) {
      const parts = action.split("_");
      const productId = Number(parts[1]);
      const selectedWeight = Number(parts[2]);
      if (!Number.isFinite(productId) || !Number.isFinite(selectedWeight) || selectedWeight <= 0) return home(sock, jid);
      const r = await getProduct(productId);
      if (!r.product) return home(sock, jid);
      s.product = r.product;
      s.weight = selectedWeight;
      s.qty = Math.max(Number(s.qty || 1), 1);
      return product(sock, jid, r.product);
    }

    // Product quantity / add-to-cart. These branches intentionally use the
    // current session product and do not depend on any older V28 branch.
    if (action.startsWith("qtyinc_") || action.startsWith("qtydec_")) {
      const productId = Number(action.split("_")[1]);
      const p = s.product?.id === productId ? s.product : (await getProduct(productId)).product;
      if (!p) return home(sock, jid);
      s.product = p;
      s.qty = Math.max(Number(s.qty || 1) + (action.startsWith("qtyinc_") ? 1 : -1), 1);
      s.step = "product";
      const f = await getFavorites(payload(jid, s.name));
      s.favorite = f.products.some(x => Number(x.id) === Number(p.id));
      const base = `🍬 *${p.name}*\n\n${p.description || "Freshly prepared and carefully packed."}\n\n💰 ${money(p.price)} / ${p.price_quantity_label}\n📦 ${p.stock_display}\n❤️ Favorite: ${s.favorite ? "Yes" : "No"}`;
      return productActions(sock, jid, p, base);
    }
    if (action.startsWith("addcart_")) {
      const p = s.product;
      if (!p) return home(sock, jid);
      const quantity = Math.max(Number(s.qty || 1), 1);
      const grams = p.is_weight_based ? Number(s.weight || p.weight_options?.[0] || 250) : 0;
      await addToCart({ ...payload(jid, s.name), product_id: p.id, quantity, quantity_grams: grams });
      s.product = null;
      s.step = "home";
      return buttons(sock, jid, `✅ *${p.name}* cart में add हो गया।\n\n🔢 Quantity: *${quantity}*`, [
        { id: "cart", text: "🛒 View Cart" },
        { id: "shop", text: "🛍 Continue" },
        { id: "checkout", text: "💳 Checkout" }
      ]);
    }
    if (action.startsWith("buynow_")) {
      const p = s.product;
      if (!p) return home(sock, jid);
      const quantity = Math.max(Number(s.qty || 1), 1);
      const grams = p.is_weight_based ? Number(s.weight || p.weight_options?.[0] || 250) : 0;
      await addToCart({ ...payload(jid, s.name), product_id: p.id, quantity, quantity_grams: grams });
      return checkoutStart(sock, jid);
    }

    // Cart management.
    if (action.startsWith("cartinc_") || action.startsWith("cartdec_") || action.startsWith("cartremove_")) {
      const cartId = Number(action.split("_")[1]);
      if (!Number.isFinite(cartId)) return cart(sock, jid);
      if (action.startsWith("cartremove_")) await removeCartItem({ ...payload(jid, name), cart_item_id: cartId });
      else await changeCartItem({ ...payload(jid, name), cart_item_id: cartId, delta: action.startsWith("cartinc_") ? 1 : -1 });
      return cart(sock, jid);
    }

    // Payment/order actions.
    if (action === "pay_cod") return createOrder(sock, jid, "cod");
    if (action === "pay_online") return createOrder(sock, jid, "online");
    if (action.startsWith("details_")) return details(sock, jid, action.slice(8));
    if (action.startsWith("track_")) return track(sock, jid, action.slice(6));
    if (action.startsWith("reorder_")) {
      const r = await reorder({ ...payload(jid, name), order_id: action.slice(8) });
      return buttons(sock, jid, r.message, [
        { id: "cart", text: "🛒 Cart" },
        { id: "checkout", text: "💳 Checkout" },
        { id: "home", text: "🏠 Home" }
      ]);
    }

    // Search text after the Search button.
    if (!action && s.step === "search" && s.waiting && incomingText) {
      s.waiting = false;
      return search(sock, jid, incomingText);
    }

    return buttons(sock, jid, "मैंने आपका message समझ लिया। नीचे buttons से आगे बढ़ें।", [
      { id: "shop", text: "🛍 Shop" },
      { id: "cart", text: "🛒 Cart" },
      { id: "home", text: "🏠 Home" }
    ]);
  } catch (error) {
    logger.error({
      event: "whatsapp.handler.error.v34",
      error: error?.message || String(error),
      stack: error?.stack,
      jid,
      incoming_text: incomingText,
      action
    }, "WhatsApp V34 handler failed");
    await sock.sendMessage(jid, { text: "⚠️ Request process नहीं हो सकी।\n\nकृपया फिर से try करें या Home दबाएँ।" }).catch(() => {});
  }
}
`;

source = source.slice(0, handleStart) + replacement + source.slice(connectStart);
source = source.replace(/\n+$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V34 applied; clean handler + no text TDZ + full action routing + stack diagnostics + syntax check passed.");
