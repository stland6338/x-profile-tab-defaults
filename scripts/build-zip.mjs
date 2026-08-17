#!/usr/bin/env node
// ストア提出用 zip を作る（Chrome / Edge 用と Firefox 用）
//   node scripts/build-zip.mjs
// 出力: dist/photos-first-for-x-<version>-chrome.zip（Chrome ウェブストア・Edge アドオン共用）
//       dist/photos-first-for-x-<version>-firefox.zip（AMO 用: background.scripts + gecko 設定）
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const FILES = [
  'background.js', 'bridge.js', 'page.js',
  'options.html', 'options.css', 'options.js',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
  '_locales',
];

function build(target, transform) {
  const stage = join(dist, `build-${target}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const f of FILES) cpSync(join(root, f), join(stage, f), { recursive: true });
  const m = transform(structuredClone(manifest));
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  const out = join(dist, `photos-first-for-x-${version}-${target}.zip`);
  rmSync(out, { force: true });
  execFileSync('zip', ['-r', '-X', out, '.', '-x', '*.DS_Store'], { cwd: stage, stdio: 'ignore' });
  rmSync(stage, { recursive: true, force: true });
  console.log('wrote', out.replace(root + '/', ''));
  return out;
}

// Chrome / Edge: manifest.json そのまま
build('chrome', (m) => m);

// Firefox (AMO): MV3 だが background は scripts、gecko ID とデータ収集宣言が必要
build('firefox', (m) => {
  m.background = { scripts: ['background.js'] };
  delete m.minimum_chrome_version;
  m.browser_specific_settings = {
    gecko: {
      id: 'photos-first-for-x@stland6338.github.io',
      strict_min_version: '128.0', // content_scripts.world = MAIN
      data_collection_permissions: { required: ['none'] },
    },
  };
  return m;
});

for (const t of ['chrome', 'firefox']) {
  const p = join(dist, `photos-first-for-x-${version}-${t}.zip`);
  if (existsSync(p)) console.log(execFileSync('unzip', ['-l', p]).toString().split('\n').filter((l) => /manifest|files$/.test(l)).join('\n'));
}
