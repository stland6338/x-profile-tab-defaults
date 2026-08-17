// ==UserScript==
// @name         Tab Defaults for X — 画像・すべてを既定に
// @name:en      Tab Defaults for X
// @namespace    https://github.com/stland6338/x-profile-tab-defaults
// @version      1.0.0
// @description  X のプロフィールを開いたとき、ポスト▼を「すべて」、メディア▼を「画像」に自動で切り替えます。リロードなし。
// @description:en  Open X profiles with “All” instead of “Posts” and “Photos” instead of “Videos” — automatically, without reloading.
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
    postsTab: 'all',      // 'all' | ''（変更しない）
    mediaFilter: 'photo', // 'photo' | ''（変更しない）
    respectManual: true,  // ドロップダウンでの手動選択を尊重する
    debug: false,
  };

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
    const prev = prevHref && CONFIG.respectManual ? new URL(prevHref, location.origin) : null;
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
  function onNavigate(prevHref) {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      scheduled = null;
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
    if (!redirecting && now !== prev) onNavigate(prev);
  });

  // 初回ロード: X の起動前に replaceState だけすると「このページは存在しません」になるため、
  // まだ描画されていなければ本物のリダイレクト（体感ほぼゼロ）、描画済みなら popstate 方式。
  const initial = computeRedirect(currentHref(), null);
  if (initial) {
    if (document.querySelector('main')) applyRedirect(initial);
    else location.replace(initial);
  }
})();
