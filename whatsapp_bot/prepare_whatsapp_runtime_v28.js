import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V28";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V28 already applied; nothing to do.");
  process.exit(0);
}

function replaceOnce(pattern, replacement, name) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`V28 could not locate ${name}.`);
  source = next;
}

function replaceFunction(startToken, endToken, replacement, name) {
  const start = source.indexOf(startToken);
  if (start < 0) throw new Error(`V28 could not locate ${name} start.`);
  const end = source.indexOf(endToken, start + startToken.length);
  if (end < 0) throw new Error(`V28 could not locate ${name} end.`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

const oldImport = 'import { addToCart, checkout, getCart, getCategories, getCustomer, getFavorites, getOrder, getOrders, getProduct, getProducts, removeCartItem, searchProducts, toggleFavorite, reorder, changeCartItem, clearCart, setLanguage } from "./api.js";';
const newImport = 'import { addToCart, checkout, getCart, getCategories, getCustomer, getFavorites, getOrder, getOrders, getProduct, getProducts, removeCartItem, searchProducts, toggleFavorite, reorder, changeCartItem, clearCart, setLanguage, saveAddress } from "./api.js";';
if (source.includes(oldImport)) source = source.replace(oldImport, newImport);
if (!source.includes("saveAddress")) throw new Error("V28 could not install saveAddress import.");

const helpers = `
const responseEditKey = (m, sock) => {
  const x = unwrap(m?.message);
  const ctx = x?.interactiveResponseMessage?.contextInfo || x?.templateButtonReplyMessage?.contextInfo || x?.listResponseMessage?.contextInfo || {};
  const id = String(ctx?.stanzaId || "").trim();
  if (!id) return null;
  return {
    remoteJid: m?.key?.remoteJid,
    fromMe: true,
    id,
    participant: sock?.user?.id || undefined,
  };
};

async function editInteractive(sock, jid, key, text, items) {
  const clean = (items || []).filter(Boolean).slice(0, 3);
  const interactiveButtons = clean.map((x) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: String(x.text || "").slice(0, 20),
      id: String(x.id || "").slice(0, 200),
    }),
  }));
  const content = {
    text: String(text || ""),
    footer: "Sweet & Snacks",
    interactiveButtons,
  };
  if (key) content.edit = key;
  return sock.sendMessage(jid, content);
}
`;
replaceOnce(/\nasync function productActions\(/, `${helpers}\nasync function productActions(`, "V28 helpers insertion");

const productActionsReplacement = `async function productActions(sock, jid, p, base, editKey = null) {
  const s = state(jid);
  const qty = Math.max(Number(s.qty || 1), 1);
  const grams = p.is_weight_based ? Number(s.weight || p.weight_options?.[0] || 250) : 0;
  const unitTotal = Number(p.price) * qty;
  const weightLine = p.is_weight_based ? \`\\n⚖️ Weight: *\${labelWeight(grams)}*\` : "";
  const text = \`\${base}\${weightLine}\\n\\n🔢 Quantity: *\${qty}*\\n🧾 Total: *\${money(unitTotal)}*\\n\\nQuantity बदलने के लिए नीचे ➖ / ➕ दबाएँ।\`;
  await editInteractive(sock, jid, editKey, text, [
    { id: \`qtydec_\${p.id}\`, text: "➖ कम" },
    { id: \`addcart_\${p.id}\`, text: \`🛒 Add \${qty}\` },
    { id: \`qtyinc_\${p.id}\`, text: "➕ बढ़ाएँ" },
  ]);
  if (!editKey) {
    await buttons(sock, jid, "More product options", [
      { id: \`buynow_\${p.id}\`, text: "⚡ Buy Now" },
      { id: \`favorite_\${p.id}\`, text: s.favorite ? "💔 Remove Favorite" : "❤️ Favorite" },
      { id: "cart", text: "🛒 Cart" },
    ]);
    await buttons(sock, jid, "Back", [
      { id: \`category_\${p.category_id}\`, text: "⬅️ Back" },
      { id: "home", text: "🏠 Home" },
    ]);
  }
}
`;
replaceFunction("async function productActions(sock, jid, p, base)", "async function addProduct(", productActionsReplacement, "productActions()");

const cartReplacement = `async function cart(sock, jid, editKey = null) {
  const s = state(jid, "Customer");
  const r = await getCart(payload(jid, s.name));
  s.step = "cart";
  if (!r.items.length) {
    const emptyText = "🛒 *MY CART*\\n\\nआपका cart अभी खाली है।\\n\\nनीचे Shop Now दबाकर product चुनें।";
    if (editKey) return editInteractive(sock, jid, editKey, emptyText, [
      { id: "shop", text: "🛍 Shop Now" },
      { id: "home", text: "🏠 Home" },
    ]);
    return buttons(sock, jid, emptyText, [{ id: "shop", text: "🛍 Shop Now" }, { id: "home", text: "🏠 Home" }]);
  }

  const lines = ["🛒 *MY CART*", ""];
  for (const x of r.items) {
    const unit = x.quantity_grams ? \`\${x.quantity} × \${labelWeight(x.quantity_grams)}\` : \`\${x.quantity} × pc\`;
    lines.push(\`🍬 *\${x.name}*\\n\${unit} = *\${money(x.subtotal)}*\`);
  }
  lines.push(\`\\n💰 *Subtotal: \${money(r.subtotal)}*\`);
  lines.push("\\n👇 Product की quantity बदलने के लिए *Manage Cart* खोलें।");

  const rows = [];
  for (const x of r.items) {
    rows.push({ id: \`cartinc_\${x.id}\`, title: \`➕ \${x.name}\`, description: \`Quantity बढ़ाएँ • अभी \${x.quantity}\` });
    rows.push({ id: \`cartdec_\${x.id}\`, title: \`➖ \${x.name}\`, description: \`Quantity घटाएँ • अभी \${x.quantity}\` });
    rows.push({ id: \`cartremove_\${x.id}\`, title: \`🗑️ \${x.name}\`, description: "इस item को cart से हटाएँ" });
  }
  rows.push({ id: "checkout", title: "💳 Checkout", description: \`Total items: \${r.total_items}\` });
  rows.push({ id: "shop", title: "🛍 Continue Shopping", description: "और products देखें" });
  rows.push({ id: "clear_cart", title: "🧹 Clear Cart", description: "सभी items हटाएँ" });

  const listButton = {
    name: "single_select",
    buttonParamsJson: JSON.stringify({
      title: "Manage Cart",
      sections: [{ title: "Cart & Actions", rows: rows.slice(0, 50) }],
    }),
  };
  const content = {
    text: lines.join("\\n"),
    footer: "Sweet & Snacks",
    interactiveButtons: [listButton],
  };
  if (editKey) content.edit = editKey;
  try {
    await sock.sendMessage(jid, content);
  } catch (error) {
    logger.error({ error: error?.message || error }, "Cart interactive template failed");
    if (editKey) {
      try { await sock.sendMessage(jid, { text: lines.join("\\n"), edit: editKey }); } catch {}
    } else {
      await sock.sendMessage(jid, { text: lines.join("\\n") });
    }
  }
}
`;
replaceFunction("async function cart(sock, jid)", "async function addresses(sock, jid)", cartReplacement, "cart()");

const parsedMarker = `logger.info({ event: "whatsapp.parsed", text, action }, "WhatsApp message parsed");`;
const branch = `
  const s = state(jid, "Customer");
  const editKey = responseEditKey(m, sock);

  if (action === "home" && ["address_line", "address_city", "address_pincode"].includes(s.step)) {
    s.addressText = "";
    s.addressCity = "";
    return home(sock, jid);
  }

  // V28: simple 3-step address entry. This prevents the old address screen
  // from looping and is easy for children, adults, and elderly customers.
  if (!action && s.step === "address_line" && text) {
    s.addressText = text.trim().slice(0, 500);
    s.step = "address_city";
    return sock.sendMessage(jid, { text: "🏙️ *Step 2/3 — City*\\n\\nअब अपना शहर लिखें।\\n\\nउदाहरण: Bhopal" });
  }
  if (!action && s.step === "address_city" && text) {
    s.addressCity = text.trim().slice(0, 100);
    s.step = "address_pincode";
    return sock.sendMessage(jid, { text: "📮 *Step 3/3 — PIN Code*\\n\\nअब 6 digit PIN code लिखें।\\n\\nउदाहरण: 462001" });
  }
  if (!action && s.step === "address_pincode" && text) {
    const pin = text.replace(/\\D/g, "").slice(0, 6);
    if (pin.length !== 6) return sock.sendMessage(jid, { text: "⚠️ PIN code 6 digit का होना चाहिए।\\n\\nकृपया फिर से 6 digit PIN code भेजें।" });
    try {
      await saveAddress({
        ...payload(jid, s.name),
        address: s.addressText,
        city: s.addressCity,
        pincode: pin,
      });
      s.addressText = "";
      s.addressCity = "";
      s.step = "address_choice";
      await sock.sendMessage(jid, { text: "✅ *Address saved successfully!*\\n\\nअब यह address अगली बार automatically use होगा।" });
      return addresses(sock, jid);
    } catch (error) {
      logger.error({ error: error?.message || error }, "WhatsApp address save failed");
      return sock.sendMessage(jid, { text: "⚠️ Address save नहीं हो पाया।\\n\\nकृपया फिर से *Add Address* दबाएँ।" });
    }
  }

  if (action === "new_address") {
    s.step = "address_line";
    s.addressText = "";
    s.addressCity = "";
    return sock.sendMessage(jid, {
      text: "📍 *Step 1/3 — Delivery Address*\\n\\nअपना House No., Street, Mohalla/Society या Landmark एक message में लिखें।\\n\\nउदाहरण: House 24, Main Road, Goraul, Near Market",
    });
  }

  // V28: edit the existing product template instead of sending a new one.
  if (action.startsWith("qtyinc_") || action.startsWith("qtydec_")) {
    const parts = action.split("_");
    const productId = Number(parts[1]);
    const p = s.product?.id === productId ? s.product : (await getProduct(productId)).product;
    if (!p) return home(sock, jid);
    s.product = p;
    s.qty = Math.max(Number(s.qty || 1) + (action.startsWith("qtyinc_") ? 1 : -1), 1);
    s.step = "product";
    const f = await getFavorites(payload(jid, s.name));
    s.favorite = f.products.some(x => x.id === p.id);
    const base = \`🍬 *\${p.name}*\\n\\n\${p.description || "Freshly prepared and carefully packed."}\\n\\n💰 \${money(p.price)} / \${p.price_quantity_label}\\n📦 \${p.stock_display}\\n❤️ Favorite: \${s.favorite ? "Yes" : "No"}\`;
    return productActions(sock, jid, p, base, editKey);
  }

  // V28: adding the product also updates the same product template.
  if (action.startsWith("addcart_")) {
    const p = s.product;
    if (!p) return home(sock, jid);
    const quantity = Math.max(Number(s.qty || 1), 1);
    const grams = p.is_weight_based ? Number(s.weight || p.weight_options?.[0] || 250) : 0;
    try {
      await addToCart({ ...payload(jid, s.name), product_id: p.id, quantity, quantity_grams: grams });
      s.product = null;
      s.step = "home";
      return editInteractive(sock, jid, editKey, \`✅ *\${p.name}* cart में add हो गया।\\n\\n🔢 Quantity: *\${quantity}*\\n\\nआप क्या करना चाहते हैं?\`, [
        { id: "cart", text: "🛒 View Cart" },
        { id: "shop", text: "🛍 Continue" },
        { id: "checkout", text: "💳 Checkout" },
      ]);
    } catch (error) {
      logger.error({ error: error?.message || error }, "WhatsApp add-to-cart failed");
      return editInteractive(sock, jid, editKey, \`⚠️ *\${p.name}* cart में add नहीं हो पाया।\\n\\n\${error?.message || "Please try again."}\`, [
        { id: \`qtydec_\${p.id}\`, text: "➖ कम" },
        { id: \`addcart_\${p.id}\`, text: \`🛒 Add \${quantity}\` },
        { id: \`qtyinc_\${p.id}\`, text: "➕ बढ़ाएँ" },
      ]);
    }
  }

  // V28: cart quantity/removal updates the same cart template.
  if (action.startsWith("cartinc_") || action.startsWith("cartdec_") || action.startsWith("cartremove_")) {
    const id = Number(action.split("_")[1]);
    try {
      if (action.startsWith("cartremove_")) await removeCartItem({ ...payload(jid, s.name), cart_item_id: id });
      else await changeCartItem({ ...payload(jid, s.name), cart_item_id: id, delta: action.startsWith("cartinc_") ? 1 : -1 });
      return cart(sock, jid, editKey);
    } catch (error) {
      logger.error({ error: error?.message || error }, "WhatsApp cart update failed");
      return cart(sock, jid, editKey);
    }
  }

`;
replaceOnce(parsedMarker, parsedMarker + branch, "parsed action branch");

source = source.replace(/\n$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V28 applied; same-template quantity/cart updates + simple 3-step address flow + syntax check passed.");
