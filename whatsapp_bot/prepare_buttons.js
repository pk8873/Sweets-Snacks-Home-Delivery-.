import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_BUTTON_FLOW_PATCH_V14";

if (source.includes(marker)) {
  console.log("WhatsApp button/function compatibility patch V14 already applied.");
  process.exit(0);
}

const replace = (pattern, replacement, name) => {
  const patched = source.replace(pattern, replacement);
  if (patched === source) throw new Error(`Unable to patch ${name}.`);
  source = patched;
};

// WhatsApp clients can return button/list replies in several envelopes.
replace(
  /const actionOf = \(m\) => \{[\s\S]*?\nconst incomingLocation/,
  'const actionOf=(m)=>{const x=unwrap(m?.message);const direct=x.buttonsResponseMessage?.selectedButtonId||x.templateButtonReplyMessage?.selectedId||x.messageContextInfo?.buttonsResponseMessage?.selectedButtonId||x.messageContextInfo?.templateButtonReplyMessage?.selectedId||x.listResponseMessage?.singleSelectReply?.selectedRowId||x.messageContextInfo?.listResponseMessage?.singleSelectReply?.selectedRowId;if(direct)return String(direct);const raw=x.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson||x.nativeFlowResponseMessage?.paramsJson;if(raw){try{const p=JSON.parse(raw);return String(p?.id||p?.selected_id||p?.selectedId||p?.button_id||p?.row_id||p?.rowId||"")}catch{}}return "";};\nconst incomingLocation',
  "action parser",
);

replace(
  /async function buttons\(sock, jid, text, items\) \{[\s\S]*?\n\}\nasync function list/,
  'async function buttons(sock,jid,text,items){const clean=items.filter(Boolean).slice(0,3);if(!clean.length)return sock.sendMessage(jid,{text});try{return await sock.sendMessage(jid,{text,footer:"Sweet & Snacks",interactiveButtons:clean.map(function(x){return {name:"quick_reply",buttonParamsJson:JSON.stringify({display_text:String(x.text).slice(0,20),id:String(x.id)})}})})}catch{try{return await sock.sendMessage(jid,{text,footer:"Sweet & Snacks",buttons:clean.map(function(x){return {buttonId:String(x.id),buttonText:{displayText:String(x.text).slice(0,20)},type:1}}),headerType:1,viewOnce:true})}catch{try{return await sock.sendMessage(jid,{text,footer:"Sweet & Snacks",templateButtons:clean.map(function(x,i){return {index:i+1,quickReplyButton:{displayText:String(x.text).slice(0,20),id:String(x.id)}}})})}catch{return sock.sendMessage(jid,{text:text+"\\n\\n"+clean.map(function(x,i){return (i+1)+". "+x.text}).join("\\n")})}}}}\nasync function list',
  "buttons",
);

replace(
  /async function list\(sock, jid, text, rows, title = "Choose"\) \{[\s\S]*?\n\}\nasync function home/,
  'async function list(sock,jid,text,rows,title="Choose"){const clean=rows.filter(Boolean).slice(0,10);if(!clean.length)return sock.sendMessage(jid,{text});try{return await sock.sendMessage(jid,{text,footer:"Sweet & Snacks",interactiveButtons:[{name:"single_select",buttonParamsJson:JSON.stringify({title:title,sections:[{title:"Options",rows:clean.map(function(x){return {title:String(x.title).slice(0,24),description:String(x.description||"").slice(0,72),id:String(x.id)}})]})}]})}catch{try{return await sock.sendMessage(jid,{title:"🍬 Sweet & Snacks",text,footer:"Sweet & Snacks",buttonText:title,sections:[{title:"Options",rows:clean.map(function(x){return {rowId:String(x.id),title:String(x.title).slice(0,24),description:String(x.description||"").slice(0,72)}})]})}catch{return sock.sendMessage(jid,{text:text+"\\n\\n"+clean.map(function(x,i){return (i+1)+". "+x.title}).join("\\n")})}}\nasync function home',
  "list",
);

replace(
  /async function home\(sock, jid\) \{[\s\S]*?\n\}\nasync function language/,
  'async function home(sock,jid){const s=state(jid);s.step="home";s.product=null;s.waiting=false;await sock.sendMessage(jid,{text:"🍬 *SWEET & SNACKS*\\n\\nनमस्ते "+s.name+"! ❤️\\nFresh sweets & snacks delivered to your door.\\n\\n👇 नीचे button दबाकर shopping शुरू करें।",footer:"Fast • Fresh • Home Delivery"});await buttons(sock,jid,"Start shopping",[{id:"shop",text:"🛍️ Shop Now"},{id:"cart",text:"🛒 My Cart"},{id:"orders",text:"📦 My Orders"}]);await buttons(sock,jid,"Quick actions",[{id:"favorites",text:"❤️ Favorites"},{id:"search",text:"🔎 Search"},{id:"address",text:"📍 My Address"}]);return buttons(sock,jid,"More options",[{id:"language",text:"🌐 Language"},{id:"help",text:"☎️ Help"}])}\nasync function language',
  "home",
);

// Match productActions whether the source has spaces after commas or not.
replace(
  /async function productActions\(sock,\s*jid,\s*p(?:,\s*base)?\)\s*\{[\s\S]*?\nasync function addProduct/,
  'async function productActions(sock,jid,p){const s=state(jid);const qty=Math.max(Number(s.qty||1),1);let price=Number(p.price||0);let weightLine="";if(p.is_weight_based){const grams=Number(s.weight||p.weight_options?.[0]||250);const baseWeight=Math.max(Number(p.weight_grams||1000),1);price=Number((Number(p.price||0)*grams/baseWeight).toFixed(2));weightLine="\\n⚖️ Weight: *"+labelWeight(grams)+"*";}const total=price*qty;const baseText="🍬 *"+p.name+"*\\n\\n"+(p.description||"Freshly prepared and carefully packed.")+"\\n\\n💰 Price: *"+money(price)+"*"+weightLine+"\\n📦 "+p.stock_display;await sock.sendMessage(jid,{text:baseText+"\\n\\n🔢 Quantity: *"+qty+"*\\n🧾 Total: *"+money(total)+"*"});if(p.is_weight_based)await list(sock,jid,"⚖️ Weight चुनें:",(p.weight_options||[250,500,750,1000]).map(function(g){return {id:"weight_"+p.id+"_"+g,title:(Number(s.weight)===Number(g)?"✅ ":"")+labelWeight(g)}}),"Choose Weight");await buttons(sock,jid,"Quantity",[{id:"qtydec_"+p.id,text:"➖"},{id:"qty_"+p.id,text:"Qty "+qty},{id:"qtyinc_"+p.id,text:"➕"}]);await buttons(sock,jid,"Order",[{id:"addcart_"+p.id,text:"🛒 Add to Cart"},{id:"buynow_"+p.id,text:"⚡ Buy Now"}]);return buttons(sock,jid,"Product",[{id:"favorite_"+p.id,text:s.favorite?"💔 Remove Favorite":"❤️ Favorite"},{id:"cart",text:"🛒 Cart"},{id:"category_"+p.category_id,text:"⬅️ Back"}])}\nasync function addProduct',
  "product actions",
);

replace(
  /async function addProduct\(sock, jid, quantity = 1, grams = 0, buyNow = false\) \{[\s\S]*?\nasync function cart/,
  'async function addProduct(sock,jid,quantity=1,grams=0,buyNow=false){const s=state(jid),p=s.product;if(!p)return home(sock,jid);const q=Math.max(Number(quantity||s.qty||1),1);const g=p.is_weight_based?Number(grams||s.weight||p.weight_options?.[0]||250):0;await addToCart({...payload(jid,s.name),product_id:p.id,quantity:q,quantity_grams:g});if(buyNow)return checkoutStart(sock,jid);s.product=null;s.step="home";return buttons(sock,jid,"✅ *"+p.name+"* cart में add हो गया।",[{id:"cart",text:"🛒 View Cart"},{id:"shop",text:"🛍 Continue Shopping"},{id:"home",text:"🏠 Home"}])}\nasync function cart',
  "addProduct",
);

replace(
  /if \(action\.startsWith\("weight_"\)\) \{[\s\S]*?\n    if \(action\.startsWith\("qtyinc_"\)/,
  'if(action.startsWith("weight_")){const parts=action.split("_");const pid=Number(parts[1]);const g=Number(parts[2]);const r=await getProduct(pid);if(!r.product)return home(sock,jid);if(!(r.product.weight_options||[]).map(Number).includes(g))return product(sock,jid,r.product);s.weight=g;s.qty=Math.max(Number(s.qty||1),1);return productActions(sock,jid,r.product)}\n    if (action.startsWith("qtyinc_")',
  "weight selection",
);

replace(
  /if \(action\.startsWith\("addcart_"\)\) return addProduct\([\s\S]*?\n    if \(action\.startsWith\("buynow_"\)\) return addProduct\([\s\S]*?;\n/,
  'if(action.startsWith("addcart_"))return addProduct(sock,jid,1,0,false);\n    if(action.startsWith("buynow_"))return addProduct(sock,jid,1,0,true);\n',
  "product action ids",
);

replace(
  /syncFullHistory: false,/,
  'syncFullHistory: false,\n    patchMessageBeforeSending:(message)=>{if(!(message.buttonsMessage||message.listMessage||message.templateMessage))return message;return {viewOnceMessage:{message:{messageContextInfo:{deviceListMetadata:{},deviceListMetadataVersion:2},...message}}}},',
  "socket button envelope",
);

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source);
console.log("WhatsApp button/function compatibility patch V14 applied.");
