import fs from "node:fs";
import { execFileSync } from "node:child_process";

const file = new URL("./index.js", import.meta.url);
const path = file.pathname;
let source = fs.readFileSync(file, "utf8");

if (!source.includes('import fs from "node:fs";')) {
  const anchor = 'import "dotenv/config";';
  if (!source.includes(anchor)) throw new Error("WhatsApp prerequisite patch could not locate import anchor.");
  source = source.replace(anchor, `${anchor}\nimport fs from "node:fs";`);
  fs.writeFileSync(file, source, "utf8");
  console.log("WhatsApp runtime prerequisite applied: node:fs import added.");
} else {
  console.log("WhatsApp runtime prerequisite already present.");
}

execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
