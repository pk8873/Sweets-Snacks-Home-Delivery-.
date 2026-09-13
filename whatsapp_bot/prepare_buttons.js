import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_BUTTON_FLOW_PATCH_V8";

if (source.includes(marker)) {
  console.log("WhatsApp button/function compatibility patch V8 already applied.");
  process.exit(0);
}

const replace = (pattern, replacement, name) => {
  const patched = source.replace(pattern, replacement);
  if (patched === source) throw new Error(`Unable to patch ${name}.`);
  source = patched;
};

replace(
  /const actionOf = \(m\) => \{[\s\S]*?\nconst incomingLocation/,
  `const actionOf=(m)=>{const x=unwrap(m?.message);const a=x.buttonsResponseMessage?.selectedButtonId||x.templateButtonReplyMessage?.selectedId||x.messageContextInfo?.buttonsResponseMessage?.selectedButtonId||x.messageContextInfo?.templateButtonReplyMessage?.selectedId||x.messageContextInfo?.listResponseMessage?.singleSelectReply?.selectedRowId||x.listResponseMessage?.singleSelectReply?.selectedRowId;if(a)return String(a);const raw=x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;if(raw){try{const p=JSON.parse(raw);return String(p?.id||p?.selected_id||p?.selectedId||p?.button_id||"")}catch{}}return "";};
const incomingLocation`,
  "action parser",
);

replace(
  /async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}\nasync function list/,
  `async function buttons(sock,jid,text,items){const clean=items.filter(Boolean).slice(0,3);if(!clean.length)return sock.sendMessage(jid,{text});try{return await sock.sendMessage(jid,{text,footer:"Sweet & Snacks",buttons:clean.map(x=>({buttonId:x.id,buttonText:{displayText:String(x.text).slice(0,20)},type:1})),headerType:1,viewOnce:true})}catch{try{return await sock.sendMessage(jid,{text,footer:"Sweet & Snacks",interactiveButtons:clean.map(x=>({name:"quick_reply",buttonParamsJson:JSON.stringify({display_text:String(x.text).slice(0,20),id:x.id})}))})}catch{return sock.sendMessage(jid,{text:text+"\\n\\n"+clean.map((x,i)=>\`${i+1}. \${x.text}\`).join("\\n")})}}}
async function list`,
  "buttons",
);

replace(
  /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}\nasync function home/,
  `async function list(sock,jid,text,rows,title="Choose"){const clean=rows.filter(Boolean).slice(0,10);if(!clean.length)return sock.sendMessage(jid,{text});try{return await sock.sendMessage(jid,{title:"🍬 Sweet & Snacks",text,footer:"Sweet & Snacks",buttonText:title,sections:[{title:"Options",rows:clean.map(x=>({rowId:x.id,title:String(x.title).slice(0,24),description:String(x.description||"").slice(0,72)}))}],viewOnce:true})}catch{try{return await sock.sendMessage(jid,{text,footer:"Sweet & Snacks",interactiveButtons:[{name:"single_select",buttonParamsJson:JSON.stringify({title,sections:[{title:"Options",rows:clean.map(x=>({title:String(x.title).slice(0,24),description:String(x.description||"").slice(0,72),id:x.id}))}]})}]})}catch{return sock.sendMessage(jid,{text:text+"\\n\\n"+clean.map((x,i)=>\`${i+1}. \${x.title}\`).join("\\n")})}}}
async function home`,
  "list",
);

replace(
  /async function productActions\(sock, jid, p, base\) \{[\s\S]*?\nasync function addProduct/,
  `async function productActions(sock,jid,p){const s=state(jid),qty=Math.max(Number(s.qty||1),1);let price=Number(p.price||0),weightLine="";if(p.is_weight_based){const grams=Number(s.weight||p.weight_options?.[0]||250),baseWeight=Math.max(Number(p.weight_grams||1000),1);price=Number((Number(p.price||0)*grams/baseWeight).toFixed(2));weightLine=\`\\n⚖️ Weight: *\${labelWeight(grams)}*\`}const total=price*qty;const base=\`🍬 *\${p.name}*\\n\\n\${p.description||"Freshly prepared and carefully packed."}\\n\\n💰 Price: *\${money(price)}*\${weightLine}\\n📦 \${p.stock_display}\`;s.step="product";await sock.sendMessage(jid,{text:\`${base}\\n\\n🔢 Quantity: *\${qty}*\\n🧾 Total: *\${money(total)}*\`});if(p.is_weight_based)await list(sock,jid,"⚖️ Weight चुनें:",(p.weight_options||[250,500,750,1000]).map(g=>({id:\`weight_\${p.id}_\${g}\`,title:\`${Number(s.weight)===Number(g)?"✅ ":""}\${labelWeight(g)}\` })),"Choose Weight");await buttons(sock,jid,"Quantity",[{id:\`qtydec_\${p.id}\`,text:"➖"},{id:\`qty_\${p.id}\`,text:\`Qty \${qty}\`},{id:\`qtyinc_\${p.id}\`,text:"➕"}]);await buttons(sock,jid,"Order",[{id:\`addcart_\${p.id}\`,text:"🛒 Add to Cart"},{id:\`buynow_\${p.id}\`,text:"⚡ Buy Now"}]);return buttons(sock,jid,"Product",[{id:\`favorite_\${p.id}\`,text:s.favorite?"💔 Remove Favorite":"❤️ Favorite"},{id:"cart",text:"🛒 Cart"},{id:\`category_\${p.category_id}\`,text:"⬅️ Back"}])}
async function addProduct`,
  "product actions",
);

replace(
  /async function addProduct\(sock, jid, quantity = 1, grams = 0, buyNow = false\) \{[\s\S]*?\nasync function cart/,
  `async function addProduct(sock,jid,productId,buyNow=false){const s=state(jid),r=await getProduct(productId),p=r.product;if(!p)return home(sock,jid);const quantity=Math.max(Number(s.qty||1),1),grams=p.is_weight_based?Number(s.weight||p.weight_options?.[0]||250):0;await addToCart({...payload(jid,s.name),product_id:p.id,quantity,quantity_grams:grams});s.product=p;if(buyNow)return checkoutStart(sock,jid);s.product=null;s.step="home";return buttons(sock,jid,\`✅ *\${p.name}* cart में add हो गया।\`,[{id:"cart",text:"🛒 View Cart"},{id:"shop",text:"🛍 Continue Shopping"},{id:"home",text:"🏠 Home"}])}
async function cart`,
  "addProduct",
);

replace(
  /if \(action\.startsWith\("weight_"\)\) \{[\s\S]*?\n    if \(action\.startsWith\("qtyinc_"\)/,
  `if(action.startsWith("weight_")){const [,pid,gt]=action.split("_"),r=await getProduct(Number(pid)),g=Number(gt);if(!r.product)return home(sock,jid);if(!(r.product.weight_options||[]).map(Number).includes(g))return product(sock,jid,r.product);s.weight=g;s.qty=Math.max(Number(s.qty||1),1);return productActions(sock,jid,r.product)}
    if (action.startsWith("qtyinc_")`,
  "weight selection",
);

replace(
  /if \(action\.startsWith\("addcart_"\)\) return addProduct\([\s\S]*?\n    if \(action\.startsWith\("buynow_"\)\) return addProduct\([\s\S]*?;\n/,
  `if(action.startsWith("addcart_"))return addProduct(sock,jid,Number(action.slice("addcart_".length)),false);
    if(action.startsWith("buynow_"))return addProduct(sock,jid,Number(action.slice("buynow_".length)),true);
`,
  "product action ids",
);

replace(
  /syncFullHistory: false,/,
  `syncFullHistory: false,
    patchMessageBeforeSending:(message)=>{if(!(message.buttonsMessage||message.listMessage))return message;return {viewOnceMessage:{message:{messageContextInfo:{deviceListMetadata:{},deviceListMetadataVersion:2},...message}}}},`,
  "socket button envelope",
);

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source);
console.log("WhatsApp button/function compatibility patch V8 applied.");
