// ==UserScript==
// @name         Xのメディア欄を画像に戻す（ポストは「すべて」に） — Photos First for X
// @name:en      Photos First for X
// @namespace    https://github.com/stland6338/x-profile-tab-defaults
// @version      1.0.1
// @description  X のメディア欄が「動画」で開くのを「画像」に、ポストを「すべて」に自動で戻します。リロードなし。
// @description:en  Fixes X's new profile tabs: open Media on Photos (not Videos) and Posts on All — automatically, no reload.
// @author       tland
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @grant        none
// @homepageURL  https://github.com/stland6338/x-profile-tab-defaults
// @supportURL   https://github.com/stland6338/x-profile-tab-defaults/issues
// ==/UserScript==

// Chrome 拡張版（page.js）と同じロジックの単体版。設定はこの CONFIG を編集する。
(() => {
  'use strict';

  const CONFIG = {
    mode: 'fixed',        // 'fixed'（いつも下の設定で開く） | 'remember'（最後に選んだものを次回以降も使う）
    postsTab: 'all',      // 'all' | ''（変更しない）
    mediaFilter: 'photo', // 'photo' | ''（変更しない）
    respectManual: true,  // ドロップダウンでの手動選択を尊重する（remember では常に有効）
    debug: false,
  };
  // remember モードの記憶先（x.com の localStorage）
  const STORE_KEY = 'xtd:remembered';
  if (CONFIG.mode === 'remember') {
    try { Object.assign(CONFIG, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (_) { /* ignore */ }
  }
  function remember(choice) {
    Object.assign(CONFIG, choice);
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ postsTab: CONFIG.postsTab, mediaFilter: CONFIG.mediaFilter })); } catch (_) { /* ignore */ }
  }

  const RESERVED = new Set([
    'home', 'explore', 'notifications', 'messages', 'chat', 'grok', 'i',
    'settings', 'search', 'compose', 'login', 'logout', 'signup', 'flow',
    'account', 'bookmarks', 'communities', 'premium', 'premium_sign_up',
    'jobs', 'history', 'verified', 'lists', 'topics', 'articles', 'notes',
    'live', 'spaces', 'places', 'hashtag', 'intent', 'share', 'tos',
    'privacy', 'about', 'download', 'help', 'welcome', 'oauth',
    'who_to_follow', 'connect_people', 'error', '404', 'rules', 'en', 'ja',
    'monetization', 'ads', 'analytics', 'business', 'purchase', 'trends',
    'events', 'moments', 'video', 'videos', 'photos', 'media', 'all',
    'highlights', 'with_replies', 'reposts', 'status', 'following', 'followers',
  ]);
  const USER_RE = /^\/([A-Za-z0-9_]{1,15})$/;
  const MEDIA_RE = /^\/([A-Za-z0-9_]{1,15})\/media$/;
  const POSTS_VARIANTS = ['all', 'highlights'];
  const log = (...a) => CONFIG.debug && console.log('[x-tab-defaults]', ...a);

  function computeRedirect(href, prevHref) {
    const u = new URL(href, location.origin);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const prev = prevHref && (CONFIG.respectManual || CONFIG.mode === 'remember') ? new URL(prevHref, location.origin) : null;
    let m;
    if (CONFIG.postsTab && !isBroken('posts') && (m = path.match(USER_RE))) {
      const user = m[1];
      if (RESERVED.has(user.toLowerCase())) return null;
      if (prev) {
        const pp = prev.pathname.toLowerCase();
        if (POSTS_VARIANTS.some((v) => pp === `/${user}/${v}`.toLowerCase())) return null;
      }
      return { href: `/${user}/${CONFIG.postsTab}`, kind: 'posts' };
    }
    if (CONFIG.mediaFilter && !isBroken('media') && (m = path.match(MEDIA_RE)) && !u.searchParams.has('filter')) {
      const user = m[1];
      if (RESERVED.has(user.toLowerCase())) return null;
      if (prev && prev.pathname.toLowerCase() === `/${user}/media`.toLowerCase() && prev.searchParams.has('filter')) return null;
      u.searchParams.set('filter', CONFIG.mediaFilter);
      return { href: u.pathname + u.search, kind: 'media' };
    }
    return null;
  }

  function detectManualChoice(href, prevHref) {
    if (!prevHref) return null;
    const u = new URL(href, location.origin);
    const p = new URL(prevHref, location.origin);
    const now = u.pathname.replace(/\/+$/, '').toLowerCase();
    const prev = p.pathname.replace(/\/+$/, '').toLowerCase();
    const m = now.match(/^\/([a-z0-9_]{1,15})(?:\/(all|highlights|media))?$/);
    if (!m || RESERVED.has(m[1])) return null;
    const base = `/${m[1]}`;
    const kind = m[2] || 'posts';
    if (kind === 'posts' && (prev === `${base}/all` || prev === `${base}/highlights`)) return { postsTab: '' };
    if (kind === 'all' && (prev === base || prev === `${base}/highlights`)) return { postsTab: 'all' };
    if (kind === 'media' && prev === `${base}/media`) {
      if (p.searchParams.get('filter') === 'photo' && !u.searchParams.has('filter')) return { mediaFilter: '' };
      if (!p.searchParams.has('filter') && u.searchParams.get('filter') === 'photo') return { mediaFilter: 'photo' };
    }
    return null;
  }

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  const currentHref = () => location.pathname + location.search;
  let redirecting = false;
  let scheduled = null;
  let lastHref = currentHref();

  function softNavigate(href) {
    redirecting = true;
    try {
      origReplaceState.call(history, history.state, '', href);
      lastHref = currentHref();
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    } finally {
      redirecting = false;
    }
  }
  function applyRedirect(target) {
    const from = currentHref();
    if (from === target.href) return;
    log('redirect', from, '→', target.href);
    softNavigate(target.href);
    // フェイルセーフ: 書き換え先が「存在しないページ」なら元に戻して、この種類の書き換えを止める
    watchRender(target.href, () => {
      markBroken(target.kind, from, target.href);
      softNavigate(from);
      watchRender(from, () => setBroken(target.kind, false)); // 元の URL でも同じエラーなら拡張のせいではない
    });
  }

  // ---- フェイルセーフ（page.js と同じ）--------------------------------------
  // X の URL 仕様が変わって書き換え先が「このページは存在しません」になっても、害を出さず「何もしない」に倒れる。
  const ERROR_SEL = '[data-testid="error-detail"]';
  const TAB_SEL = '[role="tablist"] [role="tab"]';
  const WATCH_MS = 15000; // X の起動が遅い環境でもエラー描画まで待てるように長め
  const WATCH_INTERVAL_MS = 250;
  const BROKEN_TTL_MS = 30 * 60 * 1000;
  const BROKEN_KEY = 'xtd:broken';   // localStorage: { posts?: <expires ms>, media?: <expires ms> }
  const PENDING_KEY = 'xtd:pending'; // sessionStorage: 初回ロードの location.replace をまたぐメモ
  const store = {
    get(area, key) { try { return JSON.parse(area.getItem(key) || 'null'); } catch (_) { return null; } },
    set(area, key, val) { try { val == null ? area.removeItem(key) : area.setItem(key, JSON.stringify(val)); } catch (_) { /* ignore */ } },
  };
  function isBroken(kind) {
    const b = store.get(localStorage, BROKEN_KEY);
    return !!(b && typeof b[kind] === 'number' && b[kind] > Date.now());
  }
  function setBroken(kind, on) {
    const b = store.get(localStorage, BROKEN_KEY) || {};
    if (on) b[kind] = Date.now() + BROKEN_TTL_MS; else delete b[kind];
    store.set(localStorage, BROKEN_KEY, Object.keys(b).length ? b : null);
  }
  function markBroken(kind, from, to) {
    setBroken(kind, true);
    console.warn(`[x-tab-defaults] X reported "page doesn't exist" for ${to}. Reverting to ${from} and pausing ${kind} redirects for ${BROKEN_TTL_MS / 60000} min. If this keeps happening, X may have changed its URLs — please report: https://github.com/stland6338/x-profile-tab-defaults/issues`);
  }
  function watchRender(expectHref, onError) {
    let seenClear = !document.querySelector(ERROR_SEL);
    let streak = 0; // 一瞬だけ出るエラー表示で誤検知しないよう、2 回連続で見えたときだけ発火
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (currentHref() !== expectHref || Date.now() - t0 > WATCH_MS) { clearInterval(timer); return; }
      const err = !!document.querySelector(ERROR_SEL);
      if (!seenClear) { if (!err) seenClear = true; return; }
      streak = err && document.querySelectorAll(TAB_SEL).length === 0 ? streak + 1 : 0;
      if (streak >= 2) { clearInterval(timer); onError(); }
    }, WATCH_INTERVAL_MS);
  }
  function resumePendingWatch() {
    const p = store.get(sessionStorage, PENDING_KEY);
    if (!p) return;
    store.set(sessionStorage, PENDING_KEY, null);
    if (typeof p.t !== 'number' || Date.now() - p.t > 20000) return;
    if (p.step === 'watch' && currentHref() === p.to) {
      watchRender(p.to, () => {
        markBroken(p.kind, p.from, p.to);
        store.set(sessionStorage, PENDING_KEY, { step: 'verify', from: p.from, kind: p.kind, t: Date.now() });
        location.replace(p.from);
      });
    } else if (p.step === 'verify' && currentHref() === p.from) {
      watchRender(p.from, () => setBroken(p.kind, false));
    }
  }
  function onNavigate(prevHref, fromPop = false) {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      scheduled = null;
      if (CONFIG.mode === 'remember' && !fromPop) {
        const choice = detectManualChoice(currentHref(), prevHref);
        if (choice) { log('remember', choice); remember(choice); }
      }
      const target = computeRedirect(currentHref(), prevHref);
      if (target) applyRedirect(target);
    }, 0);
  }
  function wrap(fn) {
    return function (state, title, url) {
      const prev = currentHref();
      const ret = fn.call(this, state, title, url);
      const now = currentHref();
      if (now !== prev) {
        lastHref = now;
        if (!redirecting) onNavigate(prev);
      }
      return ret;
    };
  }
  history.pushState = wrap(origPushState);
  history.replaceState = wrap(origReplaceState);
  window.addEventListener('popstate', () => {
    const prev = lastHref;
    const now = currentHref();
    lastHref = now;
    if (!redirecting && now !== prev) onNavigate(prev, true);
  });

  // 初回ロード: X の起動前に replaceState だけすると「このページは存在しません」になるため、
  // まだ描画されていなければ本物のリダイレクト（体感ほぼゼロ）、描画済みなら popstate 方式。
  resumePendingWatch();
  const initial = computeRedirect(currentHref(), null);
  if (initial) {
    if (document.querySelector('main')) applyRedirect(initial);
    else {
      store.set(sessionStorage, PENDING_KEY, { step: 'watch', from: currentHref(), to: initial.href, kind: initial.kind, t: Date.now() });
      location.replace(initial.href);
    }
  }
})();
