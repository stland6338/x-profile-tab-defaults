#!/usr/bin/env node
// ストア用画像を生成する。
//   node store-assets/build.mjs
// 前提: headless Chromium（Playwright のキャッシュ）と ImageMagick（magick）
//   HEADLESS_SHELL 環境変数で Chromium バイナリを指定できる。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const srcDir = join(here, 'src');
const buildDir = join(here, 'build');
const outDir = join(here, 'out');
mkdirSync(buildDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// ---- headless Chromium を探す ------------------------------------------------
function findHeadlessShell() {
  if (process.env.HEADLESS_SHELL) return process.env.HEADLESS_SHELL;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) return null;
  const dirs = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const d of dirs) {
    const bin = join(cache, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(bin)) return bin;
  }
  return null;
}
const shell = findHeadlessShell();
if (!shell) {
  console.error('headless Chromium が見つかりません。HEADLESS_SHELL=/path/to/chrome-headless-shell を指定してください。');
  process.exit(1);
}

// ---- options.html のプレビュー（chrome.* をシムで置き換え） ---------------------
const messages = JSON.parse(readFileSync(join(root, '_locales/ja/messages.json'), 'utf8'));
let optionsHtml = readFileSync(join(root, 'options.html'), 'utf8');
const shim = `<script>
window.chrome = {
  i18n: { getMessage: (k) => (${JSON.stringify(messages)}[k] || {}).message || '' },
  storage: {
    sync: { get: (d, cb) => cb({}), set: (v, cb) => cb && cb() },
    onChanged: { addListener() {} },
  },
};
</script>`;
optionsHtml = optionsHtml
  .replace('href="options.css"', 'href="../../options.css"')
  .replace('src="icons/icon48.png"', 'src="../../icons/icon48.png"')
  .replace('<script src="options.js"></script>', `${shim}\n<script src="../../options.js"></script>`)
  .replace('<head>', '<head>\n<meta name="color-scheme" content="dark">\n<style>main{max-width:none;}</style>');
writeFileSync(join(buildDir, 'options-preview.html'), optionsHtml);

// ---- レンダリング -----------------------------------------------------------
const targets = [
  { src: 'screenshot-2.html', out: 'screenshot-1-1280x800.png', w: 1280, h: 800 }, // メディア→画像（主機能を先頭に）
  { src: 'screenshot-1.html', out: 'screenshot-2-1280x800.png', w: 1280, h: 800 }, // ポスト→すべて
  { src: 'screenshot-3.html', out: 'screenshot-3-1280x800.png', w: 1280, h: 800 },
  { src: 'promo-small.html', out: 'promo-small-440x280.png', w: 440, h: 280 },
];

for (const t of targets) {
  const url = 'file://' + join(srcDir, t.src);
  const tmp = join(buildDir, t.out);
  execFileSync(shell, [
    '--headless', '--disable-gpu', '--no-sandbox', '--single-process', '--no-zygote',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${t.w},${t.h}`,
    `--screenshot=${tmp}`, url,
  ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 60000 });
  // CWS は 24bit PNG（アルファなし）を要求 → 背景合成して RGB に
  execFileSync('magick', [tmp, '-background', '#05070d', '-alpha', 'remove', '-alpha', 'off', '-strip', '-define', 'png:color-type=2', join(outDir, t.out)]);
  console.log('wrote', join('store-assets/out', t.out));
}
