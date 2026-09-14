import fs from "node:fs";

const path = "whatsapp_bot/index.js";
const marker = "WHATSAPP_RUNTIME_FIX_V26";
let src = fs.readFileSync(path, "utf8");

if (src.includes(marker)) {
  console.log("WhatsApp runtime fix V26 already applied; nothing to do.");
  process.exit(0);
}

// When a weight is selected, the old handler called product(), which re-entered
// step="weight" and rendered the weight selector again. Finish the selection by
// moving directly to the normal product/quantity actions instead.
const oldWeight = 'if (action.startsWith("weight_")) { const parts = action.split("_"); s.weight = Number(parts[2]); const r = await getProduct(Number(parts[1])); return product(sock, jid, r.product); }';
const newWeight = `if (action.startsWith("weight_")) {
      const parts = action.split("_");
      const productId = Number(parts[1]);
      const selectedWeight = Number(parts[2]);
      if (!Number.isFinite(productId) || !Number.isFinite(selectedWeight) || selectedWeight <= 0) return home(sock, jid);
      const r = await getProduct(productId);
      const p = r.product;
      if (!p) return home(sock, jid);
      s.product = p;
      s.weight = selectedWeight;
      s.qty = Math.max(Number(s.qty || 1), 1);
      s.step = "product";
      const f = await getFavorites(payload(jid, s.name));
      s.favorite = f.products.some(x => x.id === p.id);
      const base = \\`🍬 *${p.name}*\\n\\n${p.description || "Freshly prepared and carefully packed."}\\n\\n💰 ${money(p.price)} / ${p.price_quantity_label}\\n⚖️ Weight: *${labelWeight(selectedWeight)}*\\n📦 ${p.stock_display}\\n❤️ Favorite: ${s.favorite ? "Yes" : "No"}\\`;
      return productActions(sock, jid, p, base);
    }`;

if (!src.includes(oldWeight)) {
  throw new Error("Unable to locate WhatsApp weight handler for V26.");
}

src = src.replace(oldWeight, newWeight);
src = src.replace(/\n$/, "") + `\n\n// ${marker}\n`;
fs.writeFileSync(path, src, "utf8");
console.log("WhatsApp runtime fix V26 applied; weight selection now exits the weight step correctly.");
