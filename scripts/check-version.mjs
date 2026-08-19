#!/usr/bin/env node
// バージョン表記が 3 か所（manifest.json / userscript の @version / CHANGELOG の見出し）で一致するか確認する。
//   node scripts/check-version.mjs   … 不一致なら exit 1（build-zip / CI から呼ばれる）
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
const us = readFileSync(join(root, 'userscript', 'x-tab-defaults.user.js'), 'utf8').match(/^\/\/ @version\s+(\S+)$/m)?.[1];
const changelogHeads = [...readFileSync(join(root, 'CHANGELOG.md'), 'utf8').matchAll(/^## (\d+\.\d+\.\d+)/gm)].map((m) => m[1]);

const problems = [];
if (us !== manifest) problems.push(`userscript @version ${us} ≠ manifest ${manifest}`);
if (changelogHeads[0] !== manifest) problems.push(`CHANGELOG top entry ${changelogHeads[0]} ≠ manifest ${manifest}`);
if (problems.length) { console.error('version mismatch:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log(`version ${manifest} consistent (manifest / userscript / CHANGELOG)`);
