import fs from "node:fs";

// V29 used a fragile regex to move a state declaration after the V28 edit marker.
// The real handler already owns one state declaration near the top of handle().
// Keep this file safe for older/manual deployments: it never rewrites source.
const file = new URL("./index.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");

if (source.includes("WHATSAPP_RUNTIME_FIX_V30")) {
  console.log("WhatsApp runtime V29 compatibility check passed; V30 owns the final runtime patch.");
} else {
  console.log("WhatsApp runtime V29 compatibility step skipped; V30 should be used for the final runtime patch.");
}
