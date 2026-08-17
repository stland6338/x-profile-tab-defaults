// Photos First for X — bridge (ISOLATED world, document_start)
//
// chrome.storage.sync から設定を読み、MAIN world の page.js に CustomEvent で渡す。
// 設定変更（オプション画面）もリアルタイムで転送する。

(() => {
  'use strict';

  const EVENT_CONFIG = 'xtd:config';
  const EVENT_REQUEST = 'xtd:request';
  const EVENT_REMEMBER = 'xtd:remember';

  const DEFAULTS = {
    mode: 'fixed',
    postsTab: 'all',
    mediaFilter: 'photo',
    respectManual: true,
    debug: false,
  };

  let current = null;

  function send(cfg) {
    // world をまたぐので detail は JSON 文字列にする（Firefox 互換のため）
    window.dispatchEvent(new CustomEvent(EVENT_CONFIG, { detail: JSON.stringify(cfg) }));
  }

  window.addEventListener(EVENT_REQUEST, () => {
    if (current) send(current);
  });

  // 記憶モード: page.js が検出した手動選択を保存（onChanged 経由で全タブに配信される）
  window.addEventListener(EVENT_REMEMBER, (e) => {
    let choice = null;
    try { choice = JSON.parse(e.detail); } catch (_) { /* ignore */ }
    if (!choice || typeof choice !== 'object') return;
    const patch = {};
    for (const key of ['postsTab', 'mediaFilter']) if (key in choice) patch[key] = String(choice[key]);
    if (Object.keys(patch).length) chrome.storage.sync.set(patch);
  });

  chrome.storage.sync.get(DEFAULTS, (items) => {
    current = { ...DEFAULTS, ...items };
    send(current);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    current = { ...(current || DEFAULTS) };
    for (const key of Object.keys(changes)) {
      if (key in DEFAULTS) current[key] = changes[key].newValue;
    }
    send(current);
  });
})();
