import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
const marker = "WHATSAPP_RUNTIME_FIX_V86";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime V86 already applied; syntax check passed.");
  process.exit(0);
}

const replaceOnce = (from, to, label) => {
  if (!source.includes(from)) throw new Error(`V86 could not locate ${label}`);
  source = source.replace(from, to);
};

// Keep the existing WhatsApp/Django feature flow intact, but make the
// selected language persistent exactly like the Telegram bot.
replaceOnce(
  '    await getCustomer(payload(jid, name));',
  '    const customer = await getCustomer(payload(jid, name));\n    s.language = customer?.customer?.language || s.language || "hi";',
  "customer language sync"
);

const homeStart = source.indexOf("async function home(sock, jid) {");
const homeEnd = source.indexOf("async function language(sock, jid)", homeStart);
if (homeStart < 0 || homeEnd <= homeStart) throw new Error("V86 could not locate home() function");

const home = [
  "async function home(sock, jid) {",
  "  const s = state(jid);",
  '  s.step = "home";',
  "  s.product = null;",
  "  s.waiting = false;",
  '  const english = s.language === "en";',
  '  const mainText = english',
  '    ? `🍬 *Sweet & Snacks*\\n\\nWelcome ${s.name}! ❤️\\nFresh sweets & snacks delivered to your door.\\n\\nUse the buttons below to shop — no menu typing needed.`',
  '    : `🍬 *Sweet & Snacks*\\n\\nनमस्ते ${s.name}! ❤️\\nFresh sweets & snacks delivered to your door.\\n\\nनीचे button से पूरा shopping करें — आपको menu type करने की जरूरत नहीं है.`;',
  '  await buttons(sock, jid, mainText, english',
  '    ? [{ id: "shop", text: "🛍 Shop" }, { id: "cart", text: "🛒 My Cart" }, { id: "orders", text: "📦 My Orders" }]',
  '    : [{ id: "shop", text: "🛍 दुकान देखें" }, { id: "cart", text: "🛒 मेरी Cart" }, { id: "orders", text: "📦 मेरे Orders" }]);',
  '  await buttons(sock, jid, "Quick actions", english',
  '    ? [{ id: "favorites", text: "❤️ Favorites" }, { id: "search", text: "🔎 Search" }, { id: "address", text: "📍 My Address" }]',
  '    : [{ id: "favorites", text: "❤️ Favorites" }, { id: "search", text: "🔎 Search" }, { id: "address", text: "📍 मेरा Address" }]);',
  '  await buttons(sock, jid, "More", [{ id: "language", text: "🌐 Language" }, { id: "help", text: "☎️ Help" }]);',
  "}",
  ""
].join("\n");
source = source.slice(0, homeStart) + home + source.slice(homeEnd);

source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source, "utf8");
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });

const finalSource = fs.readFileSync(file, "utf8");
for (const required of [
  marker,
  's.language = customer?.customer?.language || s.language || "hi";',
  'text: "🛍 दुकान देखें"',
  'text: "🛒 मेरी Cart"',
  'text: "📦 मेरे Orders"',
  'text: "🛍 Shop"',
  'text: "🛒 My Cart"',
  'text: "📦 My Orders"'
]) {
  if (!finalSource.includes(required)) throw new Error(`V86 validation failed: ${required}`);
}

const activeConnectStart = finalSource.indexOf("async function connect() {");
const activeHttpStart = finalSource.indexOf("http.createServer(", activeConnectStart);
if (activeConnectStart < 0 || activeHttpStart <= activeConnectStart) throw new Error("V86 validation failed: connect() block missing");
const activeConnect = finalSource.slice(activeConnectStart, activeHttpStart);
if (activeConnect.includes("qrcode.generate")) throw new Error("V86 validation failed: QR rendering is still enabled in the active WhatsApp connection flow");
if (!activeConnect.includes("requestPairingCode")) throw new Error("V86 validation failed: pairing-code flow is missing");

console.log("WhatsApp runtime V86 applied: Telegram language-menu parity + pairing-code-only verification; all other flows unchanged.");
