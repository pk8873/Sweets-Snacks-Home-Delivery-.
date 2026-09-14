import fs from "node:fs";

// V30 is retired. Its exact-string state safety check was itself brittle and
// could stop Render startup even when index.js was valid. Keep this compatibility
// file harmless for older/manual deployments; V31 owns the final runtime patch.
const file = new URL("./index.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");

if (source.includes("WHATSAPP_RUNTIME_FIX_V31")) {
  console.log("WhatsApp runtime V30 compatibility step skipped; V31 is already installed.");
} else {
  console.log("WhatsApp runtime V30 is retired; run prepare_whatsapp_runtime_v31.js instead.");
}
