import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

const marker = "WHATSAPP_PAIRING_PATCH_V5";
if (!source.includes(marker)) {
  const greetingPattern = /const name = m\.pushName \|\| "Customer", s = state\(jid, name\), lower = text\.toLowerCase\(\)\.trim\(\);\n  try \{\n    await getCustomer\(payload\(jid, name\)\);/;
  const greetingReplacement = `const name = m.pushName || "Customer", s = state(jid, name), lower = text.toLowerCase().trim();
  try {
    if (greeting.test(lower)) return home(sock, jid);
    await getCustomer(payload(jid, name));`;

  const patched = source.replace(greetingPattern, greetingReplacement);
  if (patched === source) {
    throw new Error("Unable to add WhatsApp greeting fast-path. Expected handle() source was not found.");
  }

  source = `// ${marker}\n${patched}`;
  fs.writeFileSync(file, source);
  console.log("WhatsApp greeting fast-path patch V5 applied.");
} else {
  console.log("WhatsApp greeting fast-path patch V5 already applied.");
}
