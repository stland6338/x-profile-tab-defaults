// ==UserScript==
// @name         Xのメディア欄を画像に戻す（ポストは「すべて」に） — Photos First for X
// @name:en      Photos First for X
// @namespace    https://github.com/stland6338/x-profile-tab-defaults
// @version      1.0.0
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
    if (CONFIG.postsTab && (m = path.match(USER_RE))) {
      const user = m[1];
      if (RESERVED.has(user.toLowerCase())) return null;
      if (prev) {
        const pp = prev.pathname.toLowerCase();
        if (POSTS_VARIANTS.some((v) => pp === `/${user}/${v}`.toLowerCase())) return null;
      }
      return `/${user}/${CONFIG.postsTab}`;
    }
    if (CONFIG.mediaFilter && (m = path.match(MEDIA_RE)) && !u.searchParams.has('filter')) {
      const user = m[1];
      if (RESERVED.has(user.toLowerCase())) return null;
      if (prev && prev.pathname.toLowerCase() === `/${user}/media`.toLowerCase() && prev.searchParams.has('filter')) return null;
      u.searchParams.set('filter', CONFIG.mediaFilter);
      return u.pathname + u.search;
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

  function applyRedirect(target) {
    if (currentHref() === target) return;
    redirecting = true;
    try {
      log('redirect', currentHref(), '→', target);
      origReplaceState.call(history, history.state, '', target);
      lastHref = currentHref();
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    } finally {
      redirecting = false;
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
  const initial = computeRedirect(currentHref(), null);
  if (initial) {
    if (document.querySelector('main')) applyRedirect(initial);
    else location.replace(initial);
  }
})();
