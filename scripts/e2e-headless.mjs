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
  // Playwright の Chromium（macOS: ~/Library/Caches/ms-playwright, Linux: ~/.cache/ms-playwright）
  const caches = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
  const candidates = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
  ];
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) for (const c of candidates) {
      const bin = join(cache, d, c);
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('Chromium not found; run `npx playwright install chromium` or set CHROME_BIN');
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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); this.extId = null; ws.onmessage = (m) => this.onMessage(JSON.parse(m.data)); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); return new CDP(ws); }
  on(method, fn) { this.handlers.set(method, fn); }
  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) { const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method) { collectExtError(msg, this.extId); this.handlers.get(msg.method)?.(msg.params); }
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

// 「偽 X」: x.com への応答を CDP の Fetch で差し替える最小 SPA。
// フェイルセーフの検証は本物の X に依存すると安定しない（ログアウト時、不明な URL をログイン画面へ飛ばすことがある）ので、
// 「プロフィール URL ならタブを描画、それ以外は data-testid=error-detail を描画」だけを再現した固定ページで行う。
const FAKE_X_HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>fake x</title></head><body><main id="m"></main>
<script>
function render() {
  var p = location.pathname, m = document.getElementById('m');
  var mm = p.match(/^\\/([A-Za-z0-9_]{1,15})(?:\\/(all|with_replies|highlights|media))?$/);
  if (mm) m.innerHTML = '<div role="tablist"><div role="tab" aria-selected="' + (mm[2] === 'all') + '">すべて</div><div role="tab" aria-selected="' + (!mm[2]) + '">ポスト</div></div>';
  else m.innerHTML = '<div data-testid="error-detail">このページは存在しません。</div>';
}
window.addEventListener('popstate', function () { setTimeout(render, 300); });
setTimeout(render, 500);
</script></body></html>`;
async function serveFakeX(cdp) {
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://x.com/*', requestStage: 'Request' }] });
  cdp.on('Fetch.requestPaused', (p) => cdp.send('Fetch.fulfillRequest', {
    requestId: p.requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
    body: Buffer.from(FAKE_X_HTML).toString('base64'),
  }).catch(() => {}));
}
const readBroken = (cdp) => cdp.eval(`(() => { try { return JSON.parse(localStorage.getItem('xtd:broken') || 'null'); } catch (e) { return null; } })()`);

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail ?? ''}`); }
function skip(name, detail) { console.log(`SKIP ${name} ${detail ?? ''}`); }
// 旧 UI が配信された場合は URL だけ検証する。タブ名は X が IP で言語を決めるので ja/en の両方を受け付ける
const TAB_LABELS = { all: ['すべて', 'All'], photo: ['画像', 'Photos'] };
function expectTab(s, path, key) {
  if (s.loc !== path) return false;
  return s.redesign ? TAB_LABELS[key].some((t) => s.sel.includes(t)) : true;
}

try {
  const ver = await waitForDevtools();
  console.log(`chrome: ${ver.Browser} (${findChrome()})`);
  // 拡張の ID を特定する。Chrome 151 以降は同じ unpacked 拡張が 2 つの ID で service worker を持つことがあり、
  // 片方は options.html を開けない。候補ごとに options ページを開いて chrome.storage が使えるものを採用する。
  let extId = null;
  let candidates = [];
  for (let i = 0; i < 20 && !extId; i++) {
    await sleep(500);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    candidates = targets.filter((x) => x.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(x.url)).map((x) => new URL(x.url).host);
    for (const id of candidates) {
      const t = await newTab(`chrome-extension://${id}/options.html`);
      await sleep(800);
      const ok = await t.eval(`(() => typeof chrome !== 'undefined' && !!chrome.storage && document.title === 'Photos First for X')()`).catch(() => false);
      t.close();
      if (ok) { extId = id; break; }
    }
    if (!extId && i === 19) {
      const targets2 = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      console.log('targets:', targets2.map((x) => `${x.type} ${x.url}`).join(' | '));
    }
  }
  currentExtId = extId;
  record('extension loaded (options page reachable)', !!extId, extId || `candidates=${JSON.stringify(candidates)}`);

  // 0) フェイルセーフ（偽 X で決定的に検証。本物 X を訪れる前に行い、X の service worker の影響を受けないようにする）
  if (extId) {
    const opt0 = await newTab(`chrome-extension://${extId}/options.html`);
    await sleep(500);
    await opt0.eval(`new Promise(r => chrome.storage.sync.set({ mode: 'fixed', postsTab: '__xtd_bogus__' }, r))`);
    const fx = await newTab('about:blank');
    await serveFakeX(fx);
    //    初回ロード（location.replace 経路）: /user → /user/__xtd_bogus__ → エラー → /user に戻り、posts の書き換えが止まる
    await navigate(fx, 'https://x.com/X');
    await sleep(4000);
    let s0 = await fx.eval(STATE);
    let broken = await readBroken(fx);
    record('fail-safe (hard): broken target reverts to /user', s0.loc === '/X' && s0.tabs > 0, JSON.stringify(s0));
    record('fail-safe (hard): posts redirects paused (localStorage xtd:broken)', !!(broken && typeof broken.posts === 'number' && broken.posts > Date.now()), JSON.stringify(broken));
    //    止まっている間は SPA 遷移でも書き換えない
    await spaGo(fx, '/X/with_replies');
    await spaGo(fx, '/X');
    s0 = await fx.eval(STATE);
    record('fail-safe: while paused, /user stays untouched', s0.loc === '/X', JSON.stringify(s0));
    //    SPA 経路: 停止を解除して同じ状況を作る → 元に戻り、再び止まる
    await fx.eval(`(() => { localStorage.removeItem('xtd:broken'); return true; })()`);
    await spaGo(fx, '/X/with_replies');
    await spaGo(fx, '/X');
    await sleep(2000);
    s0 = await fx.eval(STATE);
    broken = await readBroken(fx);
    record('fail-safe (SPA): broken target reverts to /user and pauses', s0.loc === '/X' && s0.tabs > 0 && !!(broken && broken.posts), JSON.stringify({ ...s0, broken }));
    //    復帰: 設定を正常に戻し、停止フラグを消せば再び動く
    await opt0.eval(`new Promise(r => chrome.storage.sync.set({ mode: 'fixed', postsTab: 'all' }, r))`);
    await fx.eval(`(() => { localStorage.removeItem('xtd:broken'); return true; })()`);
    await spaGo(fx, '/X/with_replies');
    await spaGo(fx, '/X');
    s0 = await fx.eval(STATE);
    record('fail-safe: recovers after flag cleared (/user → /user/all)', s0.loc === '/X/all' && s0.sel.includes('すべて'), JSON.stringify(s0));
    //    フェイルセーフは console.warn で知らせる（期待どおりなので、エラー集計からは除く）
    const warns = extErrors.filter((e) => e.kind === 'warning' && e.text.includes("page doesn't exist"));
    record('fail-safe: emits console.warn (hard + SPA)', warns.length === 2, `${warns.length} warning(s)`);
    for (const w of warns) extErrors.splice(extErrors.indexOf(w), 1);
    await fx.shot('e2e-0-failsafe.png');
    await fx.send('Fetch.disable').catch(() => {});
    fx.close();
    opt0.close();
  }

  // 1) 初回ロード: /{user} → /{user}/all（描画前なので location.replace）
  let cdp = await newTab('about:blank');
  await navigate(cdp, 'https://x.com/X');
  let s = await waitForTabs(cdp);
  if (s.tabs === 0 && !s.loc.startsWith('/X')) {
    // X がプロフィールを出してくれない（ログイン壁・データセンター IP のブロック等）。拡張の不具合ではないので中立終了
    await cdp.shot('e2e-0-unreachable.png');
    console.log(`UNREACHABLE X did not render the profile (loc=${s.loc}); nothing to test`);
    chrome.kill('SIGKILL');
    process.exit(2);
  }
  record('initial load /user → /user/all', expectTab(s, '/X/all', 'all'), JSON.stringify(s));
  await cdp.shot('e2e-1-all.png');

  // 2) SPA 遷移（X のルーターと同じく pushState → popstate）
  //    /with_replies → /{user} は「タブをクリック」相当 → /all になるはず
  await spaGo(cdp, '/X/with_replies');
  await spaGo(cdp, '/X');
  s = await waitForTabs(cdp);
  record('SPA /with_replies → /user → /user/all', expectTab(s, '/X/all', 'all'), JSON.stringify(s));

  //    /all → /{user} は「ドロップダウンでポストを選んだ」相当 → そのまま
  await spaGo(cdp, '/X');
  s = await waitForTabs(cdp);
  record('SPA /all → /user keeps Posts (respectManual)', s.loc === '/X', JSON.stringify(s));

  //    /media → ?filter=photo（ログアウトだとログインへ飛ばされるので、その場合は SKIP）
  await spaGo(cdp, '/X/media');
  s = await cdp.eval(STATE);
  if (s.loc.startsWith('/X/media')) record('SPA /media → /media?filter=photo', expectTab(s, '/X/media?filter=photo', 'photo'), JSON.stringify(s));
  else skip('SPA /media → ?filter=photo', `(X redirected while logged out: ${s.loc})`);
  await cdp.shot('e2e-2-photo.png');

  // 3) 予約パスは触らない（ログアウト時は X がログイン等へ飛ばすことがあるので
  //    「/all が付かない」「filter=photo が付かない」ことだけを見る）
  const RESERVED_PATHS = ['/home', '/explore', '/notifications', '/messages', '/i/bookmarks', '/search?q=test', '/settings', '/compose/post', '/i/lists', '/X/with_replies', '/X/status/1'];
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
    record('options page renders (ja, defaults checked)', o.checked.length === 4 && o.h2.length === 3, JSON.stringify(o));
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
    await navigate(cdp, 'https://x.com/X');
    s = await waitForTabs(cdp);
    record("setting postsTab='' leaves /user untouched", s.loc === '/X', JSON.stringify(s));
    await cdp.shot('e2e-4-unchanged.png');
    cdp.close();

    // 6) 記憶モード: 手動で「すべて」を選ぶ（/user → /user/all の pushState）→ storage の postsTab が 'all' になり、
    //    別プロフィールを開くと /all に飛ぶ。次に「ポスト」を選ぶ（/all → /user）→ '' に戻る
    const opt2 = await newTab(`chrome-extension://${extId}/options.html`);
    await sleep(800);
    await opt2.eval(`new Promise(r => chrome.storage.sync.set({ mode: 'remember', postsTab: '' }, r))`);
    opt2.close();
    cdp = await newTab('about:blank');
    await navigate(cdp, 'https://x.com/X');
    await waitForTabs(cdp);
    await spaGo(cdp, '/X/all');            // ドロップダウンで「すべて」を選んだ相当
    await sleep(800);
    const opt3 = await newTab(`chrome-extension://${extId}/options.html`);
    await sleep(500);
    let st = await opt3.eval(`new Promise(r => chrome.storage.sync.get(null, r))`);
    record("remember mode: picking All stores postsTab='all'", st.postsTab === 'all', JSON.stringify(st));
    await navigate(cdp, 'https://x.com/Support');  // 別プロフィール → 記憶した 'all' で開く
    s = await waitForTabs(cdp);
    record('remember mode: next profile opens /all', s.loc === '/Support/all', JSON.stringify(s));
    await spaGo(cdp, '/Support');                  // 「ポスト」を選んだ相当 → '' を記憶
    await sleep(800);
    st = await opt3.eval(`new Promise(r => chrome.storage.sync.get(null, r))`);
    record("remember mode: picking Posts stores postsTab=''", st.postsTab === '', JSON.stringify(st));
    await opt3.eval(`new Promise(r => chrome.storage.sync.set({ mode: 'fixed', postsTab: 'all' }, r))`);
    opt3.close();
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
