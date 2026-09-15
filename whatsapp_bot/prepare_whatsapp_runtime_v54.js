import fs from "node:fs";
import { execFileSync } from "node:child_process";

const path = "whatsapp_bot/index.js";
const marker = "WHATSAPP_RUNTIME_FIX_V54";
let source = fs.readFileSync(path, "utf8");

// V54 previously inserted the version-fetch declaration after `const sock =`,
// producing `const sock = const ...` and breaking Node syntax. Repair that exact
// corruption first so every fresh Render build can recover automatically.
const malformed = /const sock = const \{ version: latestWaWebVersion, isLatest: latestWaWebVersionIsLatest \} = await fetchLatestWaWebVersion\(\);\n\s*logger\.info\(\{ event: "whatsapp\.web\.version", version: latestWaWebVersion\?\.join\?\.\("\."\), is_latest: latestWaWebVersionIsLatest \}, "Using current WhatsApp Web version"\);\n\s*makeWASocket\(\{/;

if (malformed.test(source)) {
  source = source.replace(
    malformed,
    `const { version: latestWaWebVersion, isLatest: latestWaWebVersionIsLatest } = await fetchLatestWaWebVersion();\n  logger.info({ event: "whatsapp.web.version", version: latestWaWebVersion?.join?.("."), is_latest: latestWaWebVersionIsLatest }, "Using current WhatsApp Web version");\n  const sock = makeWASocket({\n    version: latestWaWebVersion,`
  );
  source = source.includes(marker)
    ? source
    : source.replace("import \"dotenv/config\";", `import "dotenv/config";\n// ${marker}`);
  fs.writeFileSync(path, source);
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime fix V54 repaired the malformed version patch; syntax check passed.");
  process.exit(0);
}

if (source.includes(marker)) {
  // If V54 is already marked, still validate the source so a previous partial
  // edit cannot silently survive into the bot process.
  execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
  console.log("WhatsApp runtime fix V54 already applied; syntax check passed.");
  process.exit(0);
}

if (!source.includes("fetchLatestWaWebVersion")) {
  throw new Error("V54 cannot apply: fetchLatestWaWebVersion is not imported.");
}

const socketMarker = "const sock = makeWASocket({";
const socketIndex = source.indexOf(socketMarker);
if (socketIndex === -1) {
  throw new Error("V54 cannot apply: const sock = makeWASocket({ was not found.");
}

if (/version\s*:\s*latestWaWebVersion/.test(source.slice(socketIndex, socketIndex + 1200))) {
  source = `${source.slice(0, socketIndex)}const { version: latestWaWebVersion, isLatest: latestWaWebVersionIsLatest } = await fetchLatestWaWebVersion();\n  logger.info({ event: "whatsapp.web.version", version: latestWaWebVersion?.join?.("."), is_latest: latestWaWebVersionIsLatest }, "Using current WhatsApp Web version");\n  ${source.slice(socketIndex)}`;
} else {
  source = `${source.slice(0, socketIndex)}const { version: latestWaWebVersion, isLatest: latestWaWebVersionIsLatest } = await fetchLatestWaWebVersion();\n  logger.info({ event: "whatsapp.web.version", version: latestWaWebVersion?.join?.("."), is_latest: latestWaWebVersionIsLatest }, "Using current WhatsApp Web version");\n  ${source.slice(socketIndex).replace(socketMarker, `${socketMarker}\n    version: latestWaWebVersion,`, 1)}`;
}

source = source.replace("import \"dotenv/config\";", `import "dotenv/config";\n// ${marker}`);
fs.writeFileSync(path, source);
execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
console.log("WhatsApp runtime fix V54 applied; latest WhatsApp Web version is refreshed before each socket connection + syntax check passed.");
