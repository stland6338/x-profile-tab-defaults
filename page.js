// Photos First for X — page script (MAIN world, document_start)
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
  const EVENT_REMEMBER = 'xtd:remember'; // 記憶モード: 手動選択を bridge 経由で保存
  const CONFIG_WAIT_MS = 1000; // bridge から設定が届かない場合のフォールバック待ち時間

  const DEFAULTS = {
    mode: 'fixed',        // 'fixed'（いつも下の設定で開く） | 'remember'（最後に選んだものを次回以降も使う）
    postsTab: 'all',      // 'all' | ''（変更しない）
    mediaFilter: 'photo', // 'photo' | ''（変更しない）
    respectManual: true,  // ドロップダウンでの手動選択を尊重する（remember モードでは常に有効）
    debug: false,
  };
  let config = null;
  const log = (...a) => config?.debug && console.log('[x-tab-defaults]', ...a);

  // 以下 @shared の範囲は userscript/x-tab-defaults.user.js と同一（config → CONFIG のみ差し替え）。
  // 変更したら `node scripts/sync-userscript.mjs` で同期する（build-zip / CI が --check で検証）。
  // @shared-begin routing
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

  /**
   * 現在の URL から書き換え先を計算する。不要なら null。
   * @param {string} href 現在の URL（path + search）
   * @param {string|null} prevHref 直前の URL（手動選択の判定に使う）
   * @returns {{href: string, kind: 'posts'|'media'}|null}
   */
  function computeRedirect(href, prevHref) {
    if (!config) return null;
    const u = new URL(href, location.origin);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const respect = config.respectManual || config.mode === 'remember';
    const prev = prevHref && respect ? new URL(prevHref, location.origin) : null;
    let m;

    if (config.postsTab && !isBroken('posts') && (m = path.match(USER_RE))) {
      const user = m[1];
      if (RESERVED.has(user.toLowerCase())) return null;
      if (prev) {
        const pp = prev.pathname.toLowerCase();
        if (POSTS_VARIANTS.some((v) => pp === `/${user}/${v}`.toLowerCase())) return null;
      }
      return { href: `/${user}/${config.postsTab}`, kind: 'posts' };
    }

    if (config.mediaFilter && !isBroken('media') && (m = path.match(MEDIA_RE)) && !u.searchParams.has('filter')) {
      const user = m[1];
      if (RESERVED.has(user.toLowerCase())) return null;
      if (
        prev &&
        prev.pathname.toLowerCase() === `/${user}/media`.toLowerCase() &&
        prev.searchParams.has('filter')
      ) return null;
      u.searchParams.set('filter', config.mediaFilter);
      return { href: u.pathname + u.search, kind: 'media' };
    }

    return null;
  }

  /**
   * ドロップダウンでの手動選択を URL の遷移から推定する（記憶モード用）。
   * 該当すれば保存すべき設定の一部を返す。なければ null。
   *   /{user}/all|highlights → /{user}          … 「ポスト」を選んだ → postsTab ''
   *   /{user}|/{user}/highlights → /{user}/all  … 「すべて」を選んだ → postsTab 'all'
   *   /{user}/media?filter=photo → /{user}/media … 「動画」を選んだ → mediaFilter ''
   *   /{user}/media → /{user}/media?filter=photo … 「画像」を選んだ → mediaFilter 'photo'
   * （ハイライトはアカウントによって無いので記憶しない）
   */
  function detectManualChoice(href, prevHref) {
    if (!prevHref) return null;
    const u = new URL(href, location.origin);
    const p = new URL(prevHref, location.origin);
    const now = u.pathname.replace(/\/+$/, '').toLowerCase();
    const prev = p.pathname.replace(/\/+$/, '').toLowerCase();
    let m = now.match(/^\/([a-z0-9_]{1,15})(?:\/(all|highlights|media))?$/);
    if (!m || RESERVED.has(m[1])) return null;
    const user = m[1];
    const base = `/${user}`;
    const kind = m[2] || 'posts';
    if (kind === 'posts' && (prev === `${base}/all` || prev === `${base}/highlights`)) return { postsTab: '' };
    if (kind === 'all' && (prev === base || prev === `${base}/highlights`)) return { postsTab: 'all' };
    if (kind === 'media' && prev === `${base}/media`) {
      const nowPhoto = u.searchParams.get('filter') === 'photo';
      const prevPhoto = p.searchParams.get('filter') === 'photo';
      if (prevPhoto && !u.searchParams.has('filter')) return { mediaFilter: '' };
      if (!p.searchParams.has('filter') && nowPhoto) return { mediaFilter: 'photo' };
    }
    return null;
  }
  // @shared-end routing

  // ---- 履歴 API のフック ------------------------------------------------
  // @shared-begin history
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  const currentHref = () => location.pathname + location.search;

  let redirecting = false;
  let scheduled = null;
  let lastHref = currentHref();

  /** URL を差し替えて X のルーターに再描画させる（ページリロードなし） */
  function softNavigate(href) {
    redirecting = true;
    try {
      origReplaceState.call(history, history.state, '', href);
      lastHref = currentHref();
      // X のルーターに位置変更を通知（ページリロードなしで再描画される）
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
      // 元の URL でも同じエラーなら、この拡張のせいではないので解除する
      watchRender(from, () => setBroken(target.kind, false));
    });
  }

  // ---- フェイルセーフ ------------------------------------------------------
  // X の URL 仕様が変わって書き換え先が「このページは存在しません」になっても、
  // ユーザーに害を出さず「何もしない」に倒れるための保険。
  //   - 書き換え後 WATCH_MS のあいだ描画を見張り、エラー画面（タブなし）になったら元の URL に戻す
  //   - その種類（posts / media）の書き換えを BROKEN_TTL_MS のあいだ止める
  //     （x.com の localStorage に記録するので同一ブラウザの全タブで共有。期限が切れたら再挑戦する）
  //   - 初回ロードは location.replace で遷移するため、sessionStorage にメモを残して続きを行う
  const ERROR_SEL = '[data-testid="error-detail"]';
  const TAB_SEL = '[role="tablist"] [role="tab"]';
  const WATCH_MS = 15000; // X の起動が遅い環境でもエラー描画まで待てるように長め
  const WATCH_INTERVAL_MS = 250;
  const BROKEN_TTL_MS = 30 * 60 * 1000;
  const BROKEN_KEY = 'xtd:broken';   // localStorage: { posts?: <expires ms>, media?: <expires ms> }
  const PENDING_KEY = 'xtd:pending'; // sessionStorage: { step: 'watch'|'verify', from, to, kind, t }

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
  /**
   * URL 差し替え後の描画を見張る。X が「ページが存在しない」を出したら onError を呼ぶ。
   * 時間切れ・別ページへ遷移した場合は何もしない。直前のページのエラー表示が残っている場合は、
   * いったん消えてから判定する（誤検知防止）。
   */
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
  /** 初回ロードの location.replace をまたいだフェイルセーフの続き */
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
  // @shared-end history

  /** 遷移後に呼ぶ。X 側の処理が終わってから書き換えるため 1 tick 遅らせる */
  function onNavigate(prevHref, fromPop = false) {
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => {
      scheduled = null;
      // 記憶モード: 手動選択なら保存（戻る/進むは選択ではないので除外）
      if (config?.mode === 'remember' && !fromPop) {
        const choice = detectManualChoice(currentHref(), prevHref);
        if (choice) {
          config = { ...config, ...choice };
          log('remember', choice);
          window.dispatchEvent(new CustomEvent(EVENT_REMEMBER, { detail: JSON.stringify(choice) }));
        }
      }
      const target = computeRedirect(currentHref(), prevHref);
      if (target) applyRedirect(target);
    }, 0);
  }

  // @shared-begin hooks
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
    if (!redirecting && now !== prev) onNavigate(prev, true);
  });
  // @shared-end hooks

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
          log('hard redirect', currentHref(), '→', target.href);
          store.set(sessionStorage, PENDING_KEY, { step: 'watch', from: currentHref(), to: target.href, kind: target.kind, t: Date.now() });
          location.replace(target.href);
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
  resumePendingWatch();
  // bridge がすでに設定を読み終えている場合に備えて要求する
  window.dispatchEvent(new CustomEvent(EVENT_REQUEST));
  // bridge から届かない場合はデフォルトで動く
  fallbackTimer = setTimeout(() => {
    if (!initialDone) applyConfig({}, 'fallback');
  }, CONFIG_WAIT_MS);
})();
