// ツールバーのアイコンをクリックしたら設定画面を開く
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
