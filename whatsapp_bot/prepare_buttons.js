import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_BUTTON_FLOW_PATCH_V15";

const bad = 'id:String(x.id)}})]})}]';
const good = 'id:String(x.id)}})}]})}]';

if (source.includes(bad)) {
  source = source.replace(bad, good);
  if (!source.includes(marker)) source = `// ${marker}\n${source}`;
  fs.writeFileSync(file, source);
  console.log("WhatsApp button/function compatibility patch V15 applied.");
} else if (source.includes(marker)) {
  console.log("WhatsApp button/function compatibility patch V15 already applied.");
} else {
  console.log("WhatsApp button/function compatibility patch V15 not needed; checking source as-is.");
}

execFileSync(process.execPath, ["--check", file.pathname], { stdio: "inherit" });
console.log("WhatsApp bot JavaScript syntax check passed.");
