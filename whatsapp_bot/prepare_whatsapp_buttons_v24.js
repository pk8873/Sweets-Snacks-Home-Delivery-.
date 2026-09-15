import fs from "node:fs";
const file = new URL("./index.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");
if (source.includes("WHATSAPP_RUNTIME_FIX_V51")) {
  console.log("V51 is already the active WhatsApp button fix.");
  process.exit(0);
}
throw new Error("V51 must be installed before V24.");
