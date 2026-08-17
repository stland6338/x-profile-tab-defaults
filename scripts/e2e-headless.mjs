#!/usr/bin/env node
// 拡張を実際にロードした headless Chromium で動作確認する（CDP 直叩き・依存なし）
//   node scripts/e2e-headless.mjs
// 前提: Playwright の Chromium（Chrome for Testing）が ~/Library/Caches/ms-playwright にある
//   CHROME_BIN で別のバイナリを指定可。
// 注意: ログアウト状態の x.com を使うため、X 側の都合で結果がぶれる:
//   - タブクリックはログインモーダルに奪われる → SPA 遷移は pushState+popstate で再現
//   - /{user}/media はログインへ飛ばされる → SKIP 扱い
//   - セッションによって旧タブ UI（ドロップダウンなし）が配信されることがある → URL のみ検証
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'store-assets', 'build');
mkdirSync(outDir, { recursive: true });

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    const bin = join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (existsSync(bin)) return bin;
  }
  throw new Error('Chromium not found; set CHROME_BIN');
}

const port = 9333;
const profile = join(process.env.TMPDIR || tmpdir(), 'xtd-e2e-profile');
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(findChrome(), [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--load-extension=${root}`, `--disable-extensions-except=${root}`,
  '--window-size=1280,900', '--lang=ja', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForDevtools() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return r.json(); } catch {}
    await sleep(200);
  }
  throw new Error('devtools not ready');
}

// 拡張由来のコンソールエラー / 例外だけを集める（X 自身のエラーは無視）
const extErrors = [];
function collectExtError(msg, extId) {
  const isOurs = (str) => !!str && (str.includes('[x-tab-defaults]') || (extId && str.includes(`chrome-extension://${extId}/`)));
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    const text = `${d.text} ${d.exception?.description || ''} ${d.url || ''} ${JSON.stringify(d.stackTrace?.callFrames?.map((f) => f.url) || [])}`;
    if (isOurs(text)) extErrors.push({ kind: 'exception', where: location_of(d), text: text.slice(0, 300) });
  } else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    const args = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    const frames = JSON.stringify(msg.params.stackTrace?.callFrames?.map((f) => f.url) || []);
    if (isOurs(args + frames)) extErrors.push({ kind: msg.params.type, where: frames.slice(0, 120), text: args.slice(0, 300) });
  }
}
function location_of(d) { return `${d.url || ''}:${d.lineNumber ?? ''}`; }

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.extId = null; ws.onmessage = (m) => this.onMessage(JSON.parse(m.data)); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); return new CDP(ws); }
  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method) collectExtError(msg, this.extId);
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description)); return r.result.value; }
  async shot(name) { const s = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(s.data, 'base64')); }
  close() { this.ws.close(); }
}

const STATE = `(() => {
  const tabs = [...document.querySelectorAll('[role="tablist"] [role="tab"]')];
  return {
    loc: location.pathname + location.search,
    sel: tabs.filter(e => e.getAttribute('aria-selected') === 'true').map(e => e.innerText.trim()),
    tabs: tabs.length,
    redesign: tabs.some(e => e.getAttribute('aria-haspopup') === 'menu'),
  };
})()`;
async function waitForTabs(cdp, timeoutMs = 20000) {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < timeoutMs) {
    s = await cdp.eval(STATE);
    if (s.tabs > 0 && s.sel.length) return s;
    await sleep(500);
  }
  return s;
}
async function navigate(cdp, url) {
  const before = await cdp.eval('location.href');
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 40; i++) { await sleep(250); const now = await cdp.eval('location.href'); if (now !== before) return; }
}
async function spaGo(cdp, path) {
  await cdp.eval(`(() => { history.pushState(null, '', ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); return true; })()`);
  await sleep(2000);
}
let browserCdp = null;
async function newTab(url) {
  if (!browserCdp) { const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); browserCdp = await CDP.connect(v.webSocketDebuggerUrl); }
  const { targetId } = await browserCdp.send('Target.createTarget', { url });
  await sleep(300);
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const t = list.find((x) => x.id === targetId);
  const cdp = await CDP.connect(t.webSocketDebuggerUrl);
  cdp.extId = currentExtId;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}
let currentExtId = null;

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`); }
function skip(name, detail) { console.log(`SKIP ${name} ${detail ?? ''}`); }
// 旧 UI が配信された場合は URL だけ検証する
function expectTab(s, path, tabText) {
  if (s.loc !== path) return false;
  return s.redesign ? s.sel.includes(tabText) : true;
}

try {
  await waitForDevtools();
  await sleep(1500);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const sw = targets.find((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://') && x.url.endsWith('/background.js'));
  const extId = sw ? new URL(sw.url).host : null;
  currentExtId = extId;
  record('extension loaded (service worker found)', !!extId, extId);

  // 1) 初回ロード: /{user} → /{user}/all（描画前なので location.replace）
  let cdp = await newTab('about:blank');
  await navigate(cdp, 'https://x.com/nijisanji_app');
  let s = await waitForTabs(cdp);
  record('initial load /user → /user/all', expectTab(s, '/nijisanji_app/all', 'すべて'), JSON.stringify(s));
  await cdp.shot('e2e-1-all.png');

  // 2) SPA 遷移（X のルーターと同じく pushState → popstate）
  //    /with_replies → /{user} は「タブをクリック」相当 → /all になるはず
  await spaGo(cdp, '/nijisanji_app/with_replies');
  await spaGo(cdp, '/nijisanji_app');
  s = await waitForTabs(cdp);
  record('SPA /with_replies → /user → /user/all', expectTab(s, '/nijisanji_app/all', 'すべて'), JSON.stringify(s));

  //    /all → /{user} は「ドロップダウンでポストを選んだ」相当 → そのまま
  await spaGo(cdp, '/nijisanji_app');
  s = await waitForTabs(cdp);
  record('SPA /all → /user keeps Posts (respectManual)', s.loc === '/nijisanji_app', JSON.stringify(s));

  //    /media → ?filter=photo（ログアウトだとログインへ飛ばされるので、その場合は SKIP）
  await spaGo(cdp, '/nijisanji_app/media');
  s = await cdp.eval(STATE);
  if (s.loc.startsWith('/nijisanji_app/media')) record('SPA /media → /media?filter=photo', expectTab(s, '/nijisanji_app/media?filter=photo', '画像'), JSON.stringify(s));
  else skip('SPA /media → ?filter=photo', `(X redirected while logged out: ${s.loc})`);
  await cdp.shot('e2e-2-photo.png');

  // 3) 予約パスは触らない（ログアウト時は X がログイン等へ飛ばすことがあるので
  //    「/all が付かない」「filter=photo が付かない」ことだけを見る）
  const RESERVED_PATHS = ['/home', '/explore', '/notifications', '/messages', '/i/bookmarks', '/search?q=test', '/settings', '/compose/post', '/i/lists', '/nijisanji_app/with_replies', '/nijisanji_app/status/1'];
  const broken = [];
  for (const p of RESERVED_PATHS) {
    await navigate(cdp, 'https://x.com' + p);
    await sleep(2500);
    const loc = await cdp.eval('location.pathname + location.search');
    if (/\/all$/.test(loc) || /filter=photo/.test(loc)) broken.push(`${p} → ${loc}`);
  }
  record(`reserved paths untouched (${RESERVED_PATHS.length} paths)`, broken.length === 0, broken.length ? broken.join(', ') : 'ok');
  cdp.close();

  // 4) オプション画面
  if (extId) {
    const opt = await newTab(`chrome-extension://${extId}/options.html`);
    await sleep(1500);
    const o = await opt.eval(`(() => ({ title: document.title, checked: [...document.querySelectorAll('input:checked')].map(i => i.name + '=' + (i.value || i.checked)), h2: [...document.querySelectorAll('h2')].map(h => h.textContent) }))()`);
    record('options page renders (ja, defaults checked)', o.checked.length === 3 && o.h2.length === 2, JSON.stringify(o));
    await opt.shot('e2e-3-options.png');
    // エラー検出器そのものの自己診断: 拡張ページで意図的にエラーを出して拾えることを確認
    await opt.eval(`(() => { console.error('[x-tab-defaults] selfcheck'); return true; })()`);
    await sleep(500);
    const si = extErrors.findIndex((e) => e.text.includes('selfcheck'));
    record('console error detector works (selfcheck)', si >= 0, si >= 0 ? 'captured' : 'NOT captured');
    if (si >= 0) extErrors.splice(si, 1);

    // 5) 設定変更 → 反映: postsTab='' （変更しない）→ /{user} のまま
    await opt.eval(`(() => { document.querySelector('input[name="postsTab"][value=""]').click(); return true; })()`);
    await sleep(800);
    const stored = await opt.eval(`new Promise(r => chrome.storage.sync.get(null, r))`);
    record('options saves to storage', stored.postsTab === '', JSON.stringify(stored));
    opt.close();

    cdp = await newTab('about:blank');
    await navigate(cdp, 'https://x.com/nijisanji_app');
    s = await waitForTabs(cdp);
    record("setting postsTab='' leaves /user untouched", s.loc === '/nijisanji_app', JSON.stringify(s));
    await cdp.shot('e2e-4-unchanged.png');
    cdp.close();
  }
} catch (e) {
  console.error('ERROR', e);
} finally {
  chrome.kill('SIGKILL');
}
record('no console errors/exceptions from the extension', extErrors.length === 0, extErrors.length ? JSON.stringify(extErrors.slice(0, 5)) : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
