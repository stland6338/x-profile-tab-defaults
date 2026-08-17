// Photos First for X — options page

const DEFAULTS = {
  mode: 'fixed',
  postsTab: 'all',
  mediaFilter: 'photo',
  respectManual: true,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// i18n: data-i18n 属性を持つ要素のテキストを置換
for (const el of $$('[data-i18n]')) {
  const msg = chrome.i18n.getMessage(el.dataset.i18n);
  if (msg) el.textContent = msg;
}

function render(cfg) {
  for (const input of $$('input[name="mode"]')) input.checked = input.value === (cfg.mode || 'fixed');
  for (const input of $$('input[name="postsTab"]')) input.checked = input.value === (cfg.postsTab || '');
  for (const input of $$('input[name="mediaFilter"]')) input.checked = input.value === (cfg.mediaFilter || '');
  $('input[name="respectManual"]').checked = !!cfg.respectManual;
}

let statusTimer = null;
function showSaved() {
  const el = $('#status');
  el.textContent = chrome.i18n.getMessage('saved') || 'Saved';
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}

function save() {
  const mode = $('input[name="mode"]:checked')?.value || 'fixed';
  const postsTab = $('input[name="postsTab"]:checked')?.value || '';
  const mediaFilter = $('input[name="mediaFilter"]:checked')?.value || '';
  const respectManual = $('input[name="respectManual"]').checked;
  // '' = 変更しない（null は storage で扱いが不安定なので空文字で保存）
  chrome.storage.sync.set({ mode, postsTab, mediaFilter, respectManual }, showSaved);
}

chrome.storage.sync.get(DEFAULTS, (items) => {
  render({ ...DEFAULTS, ...items });
  for (const input of $$('input')) input.addEventListener('change', save);
});

// 記憶モードで X 側の操作により設定が変わったら、開いている設定画面にも反映
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.storage.sync.get(DEFAULTS, (items) => render({ ...DEFAULTS, ...items }));
});
