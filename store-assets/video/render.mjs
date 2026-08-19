#!/usr/bin/env node
// explainer.html を 1 フレームずつ描画して mp4（＋任意で gif）にする
//   node store-assets/video/render.mjs            … 30fps・24秒 → store-assets/out/explainer-1280x720.mp4
//   node store-assets/video/render.mjs --preview  … 1秒おきのフレームだけ撮って contact sheet を作る（レイアウト確認用）
// 前提: store-assets/video に playwright がインストールされていること（package.json 参照）
import { chromium } from 'playwright';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)));
const root = resolve(here, '..', '..');
const out = join(root, 'store-assets', 'out');
const frames = join(here, 'frames');
const preview = process.argv.includes('--preview');
const FPS = 30, T = 24, W = 1280, H = 720;
rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true }); mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.goto('file://' + join(here, 'explainer.html'));
await page.evaluate(() => document.fonts.ready);
const step = preview ? 1 : 1 / FPS;
const n = preview ? T + 1 : T * FPS;
console.time('render');
for (let i = 0; i < n; i++) {
  const t = Math.min(T, i * step);
  await page.evaluate((t) => window.__seek(t), t);
  await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`), type: 'png' });
  if (i % 60 === 0) console.log(`frame ${i}/${n}`);
}
console.timeEnd('render');
await browser.close();

if (preview) {
  const files = readdirSync(frames).filter((f) => f.endsWith('.png')).sort();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', join(frames, 'f%04d.png'), '-vf', `scale=640:-1,tile=5x${Math.ceil(files.length / 5)}`, '-frames:v', '1', join(here, 'preview.png')]);
  console.log('preview →', join(here, 'preview.png'));
} else {
  const mp4 = join(out, 'explainer-1280x720.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%04d.png'), '-vf', `scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', mp4]);
  console.log('mp4 →', mp4);
  if (process.argv.includes('--gif')) {
    const gif = join(out, 'explainer-800.gif');
    const pal = join(here, 'palette.png');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'fps=12,scale=800:-1:flags=lanczos,palettegen=max_colors=160', pal]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-i', pal, '-lavfi', 'fps=12,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4', gif]);
    console.log('gif →', gif);
  }
}
