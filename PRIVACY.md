# Privacy Policy — Photos First for X

_Last updated: 2026-08-19_

**Photos First for X** does not collect, store, transmit, or share any personal data.

- The extension runs only on `https://x.com/*` and `https://twitter.com/*`.
- It changes which tab view is shown on X profile pages by adjusting the page URL inside your browser (e.g. `/username` → `/username/all`, `/username/media` → `/username/media?filter=photo`). Nothing is sent anywhere.
- Your preferences (which tab to use as default) are saved with `chrome.storage.sync`, which is managed by your browser and, if you are signed in to Chrome, synced by Google to your other devices. The extension itself has no server.
- As a safety measure, if X reports that a rewritten URL does not exist, the extension writes a small flag (a timestamp under the key `xtd:broken`) to x.com's `localStorage` in your browser so it stops rewriting for 30 minutes. This contains no personal data and never leaves your browser.
- No analytics, no tracking, no remote code, no third-party services.

If you have questions, open an issue at https://github.com/stland6338/x-profile-tab-defaults/issues.

---

# プライバシーポリシー — Photos First for X

_最終更新: 2026-08-19_

**Photos First for X** は、個人情報を一切収集・保存・送信・共有しません。

- 動作するのは `https://x.com/*` と `https://twitter.com/*` のみです。
- X のプロフィールページで表示するタブを、ブラウザ内で URL を書き換えることで切り替えます（例: `/username` → `/username/all`、`/username/media` → `/username/media?filter=photo`）。外部への送信はありません。
- 設定（どのタブを既定にするか）は `chrome.storage.sync` に保存されます。これはブラウザが管理する領域で、Chrome にサインインしている場合は Google によって他の端末と同期されます。拡張機能自体はサーバーを持ちません。
- 安全策として、書き換え先の URL を X が「存在しない」と返した場合、30 分間書き換えを止めるための小さなフラグ（キー `xtd:broken`、中身はタイムスタンプ）をブラウザ内の x.com の `localStorage` に書き込みます。個人情報は含まれず、ブラウザの外には出ません。
- 解析・トラッキング・リモートコード・第三者サービスの利用はありません。

ご質問は https://github.com/stland6338/x-profile-tab-defaults/issues までお願いします。
