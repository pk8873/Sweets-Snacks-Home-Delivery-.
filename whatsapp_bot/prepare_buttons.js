import fs from "node:fs";

const file = new URL("./index.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");
const marker = "WHATSAPP_BUTTON_FLOW_PATCH_V15";

if (source.includes(marker)) {
  console.log("WhatsApp button/function compatibility patch V15 already applied.");
  process.exit(0);
}

// V14 generated a valid button flow except for one missing closing brace in
// the single-select list payload. Fix that exact generated fragment first.
const bad = 'id:String(x.id)}})]})}]';
const good = 'id:String(x.id)}})}]})}]';

if (!source.includes(bad)) {
  throw new Error("Unable to patch V14 list syntax. Expected V14 list fragment was not found.");
}

source = source.replace(bad, good);
source = `// ${marker}\n${source}`;
fs.writeFileSync(file, source);

console.log("WhatsApp button/function compatibility patch V15 applied.");

// Validate the generated WhatsApp bot before Render starts it.
// This gives a direct startup error here instead of a later module parse error.
