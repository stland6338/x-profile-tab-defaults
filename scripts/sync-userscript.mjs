#!/usr/bin/env node
// page.js の共有ブロック（// @shared-begin <name> 〜 // @shared-end <name>）を
// userscript/x-tab-defaults.user.js の同名ブロックへ流し込む（config → CONFIG に置換）。
//   node scripts/sync-userscript.mjs          … 同期して書き込む
//   node scripts/sync-userscript.mjs --check  … 差分があれば exit 1（build-zip / CI 用）
// 2 ファイルに同じロジックを手書きしていると片方だけ直して差が出るので、page.js を正本にする。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'page.js');
const DST = join(root, 'userscript', 'x-tab-defaults.user.js');
const check = process.argv.includes('--check');

const src = readFileSync(SRC, 'utf8');
let dst = readFileSync(DST, 'utf8');

const BEGIN = (n) => `  // @shared-begin ${n}\n`;
const END = (n) => `  // @shared-end ${n}\n`;

const names = [...src.matchAll(/^ {2}\/\/ @shared-begin (\w+)$/gm)].map((m) => m[1]);
if (!names.length) { console.error('no @shared blocks in page.js'); process.exit(1); }

function block(text, name, file) {
  const b = text.indexOf(BEGIN(name));
  const e = text.indexOf(END(name));
  if (b < 0 || e < 0 || e < b) { console.error(`block "${name}" not found in ${file}`); process.exit(1); }
  return { start: b + BEGIN(name).length, end: e, body: text.slice(b + BEGIN(name).length, e) };
}

let changed = [];
for (const name of names) {
  const s = block(src, name, 'page.js');
  const body = s.body.replace(/\bconfig\b/g, 'CONFIG');
  const d = block(dst, name, 'userscript');
  if (d.body !== body) {
    changed.push(name);
    dst = dst.slice(0, d.start) + body + dst.slice(d.end);
  }
}

if (check) {
  if (changed.length) {
    console.error(`userscript is out of sync with page.js in block(s): ${changed.join(', ')}\n→ run: node scripts/sync-userscript.mjs`);
    process.exit(1);
  }
  console.log(`userscript in sync with page.js (${names.join(', ')})`);
} else {
  if (changed.length) { writeFileSync(DST, dst); console.log(`synced block(s): ${changed.join(', ')} → ${DST.replace(root + '/', '')}`); }
  else console.log('already in sync');
}
