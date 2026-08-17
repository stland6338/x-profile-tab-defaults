// Tab Defaults for X — page script (MAIN world, document_start)
//
// x.com のプロフィールで
//   /{user}          → /{user}/all               （ポスト → すべて）
//   /{user}/media    → /{user}/media?filter=photo（動画 → 画像）
// に自動で書き換える。SPA 遷移は history.pushState/replaceState/popstate を監視し、
// 書き換え後に popstate を発火して X のルーターに再描画させる（ページリロードなし）。
//
// 設定は bridge.js（ISOLATED world）から CustomEvent で受け取る。

(() => {
  'use strict';

  const EVENT_CONFIG = 'xtd:config';
  const EVENT_REQUEST = 'xtd:request';
  const CONFIG_WAIT_MS = 1000; // bridge から設定が届かない場合のフォールバック待ち時間

  const DEFAULTS = {
    postsTab: 'all',      // 'all' | ''（変更しない）
    mediaFilter: 'photo', // 'photo' | ''（変更しない）
    respectManual: true,  // ドロップダウンでの手動選択を尊重する
    debug: false,
  };
  let config = null;

  // /{name} が「プロフィール」ではない X の予約パス（小文字）
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
  // ここから /{user} へ遷移するのはドロップダウンで「ポスト」を選んだときだけ
  // （ハイライトは設定項目にはないが、ユーザーがドロップダウンで選ぶことはあるので含める）
  const POSTS_VARIANTS = ['all', 'highlights'];

  const log = (...a) => config?.debug && console.log('[x-tab-defaults]', ...a);

  /**
   * 現在の URL から書き換え先を計算する。不要なら null。
   * @param {string} href 現在の URL（path + search）
   * @param {string|null} prevHref 直前の URL（手動選択の判定に使う）
   */
  function computeRedirect(href, prevHref) {
    if (!config) return null;
    const u = new URL(href, location.origin);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const prev = prevHref && config.respectManual ? new URL(prevHref, location.origin) : null;
    let m;

    if (config.postsTab && (m = path.match(USER_RE))) {
      const user = m[1];
      if (RESERVED.has(user.toLowerCase())) return null;
      if (prev) {
        const pp = prev.pathname.toLowerCase();
        if (POSTS_VARIANTS.some((v) => pp === `/${user}/${v}`.toLowerCase())) return null;
      }
      return `/${user}/${config.postsTab}`;
    }

    if (config.mediaFilter && (m = path.match(MEDIA_RE)) && !u.searchParams.has('filter')) {
      const user = m[1];
      if (RESERVED.has(user.toLowerCase())) return null;
      if (
        prev &&
        prev.pathname.toLowerCase() === `/${user}/media`.toLowerCase() &&
        prev.searchParams.has('filter')
      ) return null;
      u.searchParams.set('filter', config.mediaFilter);
      return u.pathname + u.search;
    }

    return null;
  }

  // ---- 履歴 API のフック ------------------------------------------------
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
      // X のルーターに位置変更を通知（ページリロードなしで再描画される）
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    } finally {
      redirecting = false;
    }
  }

  /** 遷移後に呼ぶ。X 側の処理が終わってから書き換えるため 1 tick 遅らせる */
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

  // 戻る/進む（自前で発火した popstate は redirecting 中なので無視される）
  window.addEventListener('popstate', () => {
    const prev = lastHref;
    const now = currentHref();
    lastHref = now;
    if (!redirecting && now !== prev) onNavigate(prev);
  });

  // ---- 設定の受け取り -----------------------------------------------------
  let initialDone = false;
  let fallbackTimer = null;

  // X のアプリが起動済み（<main> を描画済み）かどうか。
  // 起動前に history.replaceState で URL だけ差し替えると X は「このページは存在しません」になる
  // （初期ルートをサーバー埋め込み情報から決めているらしい）ので、起動前は本物のリダイレクトを使う。
  const appBooted = () => !!document.querySelector('main');

  function applyConfig(next, reason) {
    const prevConfig = config;
    config = { ...DEFAULTS, ...next };
    log('config', reason, config);
    if (!initialDone) {
      initialDone = true;
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      const target = computeRedirect(currentHref(), null);
      if (target) {
        if (appBooted()) {
          applyRedirect(target);
        } else {
          // まだ何も描画されていないので、ここでの再読み込みは体感ほぼゼロ
          log('hard redirect', currentHref(), '→', target);
          location.replace(target);
        }
      }
    } else if (prevConfig && (prevConfig.postsTab !== config.postsTab || prevConfig.mediaFilter !== config.mediaFilter)) {
      // 設定変更時: 今見ているページにも即反映
      const target = computeRedirect(currentHref(), null);
      if (target) applyRedirect(target);
    }
  }

  window.addEventListener(EVENT_CONFIG, (e) => {
    let next = null;
    try { next = JSON.parse(e.detail); } catch (_) { /* ignore */ }
    if (next && typeof next === 'object') applyConfig(next, 'event');
  });
  // bridge がすでに設定を読み終えている場合に備えて要求する
  window.dispatchEvent(new CustomEvent(EVENT_REQUEST));
  // bridge から届かない場合はデフォルトで動く
  fallbackTimer = setTimeout(() => {
    if (!initialDone) applyConfig({}, 'fallback');
  }, CONFIG_WAIT_MS);
})();
