# Chrome ウェブストア 掲載情報（コピペ用）

ダッシュボード: https://chrome.google.com/webstore/devconsole

## 基本

| 項目 | 値 |
|---|---|
| カテゴリ | Social & Communication（または Productivity → Tools） |
| 言語 | 日本語（デフォルト）＋ English |
| ホームページ URL | https://photos-first-for-x.pages.dev/ （`site/`、`./scripts/deploy-site.sh` でデプロイ） |
| サポート URL | https://github.com/stland6338/x-profile-tab-defaults |
| プライバシーポリシー URL | https://photos-first-for-x.pages.dev/privacy （GitHub の blob URL は Google のチェッカーが取得できず NG だった） |
| 公開範囲 | 公開（Public） |
| 価格 | 無料 |

## 掲載名（45文字以内）

- ja: `Xのメディア欄を画像に戻す（ポストは「すべて」に）`（26字）
- en: `Photos First for X`

## 概要（132文字以内・検索結果に出る）

- ja: `X のメディア欄が「動画」で開くのを「画像」に、ポストを「すべて」に自動で戻します。リロードなし・設定不要。`
- en: `Fixes X's new profile tabs: open Media on Photos (not Videos) and Posts on All — automatically, no reload.`

## 詳しい説明（ja）

```
2026年7月の X プロフィール改修で、「ポスト」タブは「すべて／ポスト／ハイライト」、「メディア」タブは「動画／画像」のドロップダウンになり、開くたびに「ポスト」「動画」に戻るようになりました。X にはこれを固定する設定がありません。

Photos First for X は、プロフィールを開いたときに自動で
・ポスト▼ →「すべて」
・メディア▼ →「画像」
を選んだ状態にします。

■ 特長
・ページのリロードなし（URL をその場で書き換えて X に再描画させるだけ）
・インストール直後から動作。設定画面でそれぞれ「変更しない」にもできる
・「記憶」モードにすると、ドロップダウンで最後に選んだものを次回以降も使う（X が本来やるべき挙動）
・自分でドロップダウンから「ポスト」「動画」を選び直したときは、そのまま（上書きしません）
・x.com / twitter.com 以外では一切動作しません
・データ収集なし・通信なし・オープンソース（MIT）

■ 仕組み
X の Web 版では表示するタブが URL で決まります（/ユーザー名/all、/ユーザー名/media?filter=photo）。この拡張はページ内の遷移を監視し、該当ページを開いたときにこの URL へ切り替えます。

■ 注意
X 側の URL 仕様が変わると動かなくなることがあります。不具合は GitHub の Issues へお知らせください。
本拡張は X Corp. とは無関係の非公式ツールです。
```

## 詳しい説明（en）

```
Since X's July 2026 profile redesign, the "Posts" tab became a dropdown (All / Posts / Highlights) and the "Media" tab became Videos / Photos — and they reset to "Posts" and "Videos" every time. X has no setting to change this.

Photos First for X automatically switches a profile to
• Posts ▾ → "All"
• Media ▾ → "Photos"
the moment you open it.

■ Features
• No page reload — it just rewrites the URL in place and lets X re-render
• Works right after install; the options page lets you turn either rule off
• "Remember" mode reuses whatever you last picked from the dropdown (what X should have done)
• If you manually choose "Posts" or "Videos" from the dropdown, it respects your choice
• Runs only on x.com / twitter.com
• No data collection, no network requests, open source (MIT)

■ How it works
On the X web app the visible tab is determined by the URL (/username/all, /username/media?filter=photo). The extension watches in-page navigation and switches to that URL when you open a profile.

■ Note
If X changes its URL scheme this may stop working — please report on GitHub Issues.
This is an unofficial tool and is not affiliated with X Corp.
```

## プライバシー（Privacy practices タブ）

| 設問 | 回答 |
|---|---|
| Single purpose | X のプロフィールページで既定表示されるタブ（ポスト▼／メディア▼）を、利用者が選んだもの（すべて／画像 など）に自動で切り替える。 |
| `storage` の理由 | 利用者の設定（どのタブを既定にするか）を保存するため。 |
| Host permission（x.com / twitter.com）の理由 | プロフィールページ内の遷移を監視して URL を書き換えるコンテンツスクリプトを X 上で動かすため。他サイトでは動作しない。 |
| リモートコード | 使用しない（No, I am not using remote code） |
| データ収集 | すべて「収集しない」にチェック |
| 認定 | 3 つのポリシー遵守チェックにチェック |

## 画像

| 種類 | サイズ | ファイル |
|---|---|---|
| ストアアイコン | 128×128 | `icons/icon128.png` |
| スクリーンショット 1 | 1280×800 | `store-assets/out/screenshot-1-1280x800.png` |
| スクリーンショット 2 | 1280×800 | `store-assets/out/screenshot-2-1280x800.png` |
| スクリーンショット 3 | 1280×800 | `store-assets/out/screenshot-3-1280x800.png` |
| 小プロモタイル | 440×280 | `store-assets/out/promo-small-440x280.png` |

再生成: `node store-assets/build.mjs`

## Firefox（AMO）/ Edge アドオン

| ストア | URL | 提出物 | 備考 |
|---|---|---|---|
| Firefox Add-ons (AMO) | https://addons.mozilla.org/developers/ | `dist/photos-first-for-x-<ver>-firefox.zip` | 無料。データ収集は「なし」（manifest の `data_collection_permissions` で宣言済み）。審査は自動＋人手で数時間〜数日 |
| Microsoft Edge アドオン | https://partner.microsoft.com/dashboard/microsoftedge/ | `dist/photos-first-for-x-<ver>-chrome.zip` | 無料。掲載文は Chrome と同じでよい。審査 1〜7 日 |

## Greasy Fork（ユーザースクリプト版）

- https://greasyfork.org/ja/script_versions/new に `userscript/x-tab-defaults.user.js` をアップロード
- 説明文は上の ja/en を流用（メタデータの `@description` にも入っている）
