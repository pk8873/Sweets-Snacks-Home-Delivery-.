import fs from "node:fs";

const path = "whatsapp_bot/index.js";
const marker = "WHATSAPP_RUNTIME_FIX_V54";
let source = fs.readFileSync(path, "utf8");

if (source.includes(marker)) {
  console.log("WhatsApp runtime fix V54 already applied; skipping.");
  process.exit(0);
}

if (!source.includes("fetchLatestWaWebVersion")) {
  throw new Error("V54 cannot apply: fetchLatestWaWebVersion is not imported.");
}

const socketMarker = "makeWASocket({";
const socketIndex = source.indexOf(socketMarker);
if (socketIndex === -1) {
  throw new Error("V54 cannot apply: makeWASocket({ was not found.");
}

const before = source.slice(0, socketIndex);
const after = source.slice(socketIndex);

if (/version\s*:\s*\w+/.test(after.slice(0, 1200))) {
  console.log("WhatsApp socket already has a version option; V54 marker will be added only.");
  source = `${before}/* ${marker}: fetchLatestWaWebVersion is already configured. */\n${after}`;
} else {
  const injection = `const { version: latestWaWebVersion, isLatest: latestWaWebVersionIsLatest } = await fetchLatestWaWebVersion();\n  logger.info({ event: "whatsapp.web.version", version: latestWaWebVersion?.join?.("."), is_latest: latestWaWebVersionIsLatest }, "Using current WhatsApp Web version");\n  `;
  source = `${before}${injection}${after.replace(socketMarker, `${socketMarker}\n    version: latestWaWebVersion,`, 1)}`;
  source = source.replace("import \"dotenv/config\";", `import "dotenv/config";\n// ${marker}`);
}

fs.writeFileSync(path, source);
console.log("WhatsApp runtime fix V54 applied; latest WhatsApp Web version is refreshed before each socket connection + syntax check passed.");
