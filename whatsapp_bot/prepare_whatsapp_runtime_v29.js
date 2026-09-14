import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = new URL('./index.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8');
const marker = 'WHATSAPP_RUNTIME_FIX_V29';
if (source.includes(marker)) {
  console.log('WhatsApp runtime fix V29 already applied; nothing to do.');
  process.exit(0);
}

const editMarker = 'const editKey = responseEditKey(m, sock);';
const editPos = source.indexOf(editMarker);
if (editPos < 0) throw new Error('V29 could not locate V28 editKey marker.');

const stateRe = /const s = state\([^;]+;\s*/g;
stateRe.lastIndex = editPos + editMarker.length;
const match = stateRe.exec(source);
if (!match) throw new Error('V29 could not locate main handler state declaration after V28 branch.');

const declaration = match[0];
const declarationPos = match.index;
let next = source.slice(0, declarationPos) + source.slice(declarationPos + declaration.length);
const newEditPos = next.indexOf(editMarker);
if (newEditPos < 0) throw new Error('V29 lost V28 editKey marker.');
const insert = `  ${declaration.trim()}\n`;
next = next.slice(0, newEditPos) + insert + next.slice(newEditPos);

const tagged = next.replace('const editKey = responseEditKey(m, sock);', `// ${marker}: initialize session state before any V28 branch can read s.\n  const editKey = responseEditKey(m, sock);`);

fs.writeFileSync(file, tagged);
execFileSync(process.execPath, ['--check', file.pathname], { stdio: 'inherit' });
console.log('WhatsApp runtime fix V29 applied; fixed state initialization order + syntax check passed.');
