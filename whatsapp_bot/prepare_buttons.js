import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_BUTTON_FLOW_PATCH_V6";

if (source.includes(marker)) {
  console.log("WhatsApp button/function compatibility patch V6 already applied.");
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
console.log("WhatsApp button/function compatibility patch V6 applied.");
