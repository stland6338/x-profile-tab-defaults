# 公開チェックリスト

## 0. 手元で最終確認

自動テスト（ログアウト状態・headless）: `node scripts/e2e-headless.mjs` → 13/13 PASS（2026-08-17 確認済、記憶モード含む）
- 初回ロード / SPA 遷移 / 手動選択の尊重 / 設定画面の描画・保存・反映
- 予約パス 11 件（/home /explore /notifications /messages /i/bookmarks /search /settings /compose /i/lists /with_replies /status）で URL が書き換わらない
- 拡張由来（page.js / bridge.js / `[x-tab-defaults]`）のコンソールエラー・例外がゼロ（検出器の自己診断つき）

実ブラウザ（ログイン状態）で — 2026-08-17 Claude in Chrome で自動実行し全項目確認済み:

- [x] `chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを読み込む
- [x] x.com で誰かのプロフィールを開く → タブが「すべて ▾」になる（URL 直打ち・ホームの著者名クリックの両方）
- [x] 「メディア」を押す → 「画像 ▾」になる（戻るで /all に戻ることも確認）
- [x] 「画像 ▾」→ドロップダウンで「動画」を選ぶ → 動画のまま（上書きされない）
- [ ] ツールバーのアイコン → 設定画面が開く（※ 自動化不可・手動で 1 回確認） → ポストタブを「変更しない」にする → プロフィールを開き直すと「ポスト」のまま → 「すべて」に戻す
- [x] `/home` `/explore` `/notifications` `/i/bookmarks`(→/i/history) `/search` `/settings` `/messages`(→/i/chat) が壊れていない（フルロード＋左ナビの SPA 遷移）
- [x] DevTools コンソールに `[x-tab-defaults]` や `page.js` / `bridge.js` 由来のエラーが出ていない（X 自身のエラーは無視してよい）

## 1. GitHub 公開

```bash
cd ~/Claude/Projects/x-profile-tab-defaults
git init && git add -A && git commit -m "feat: initial release 1.0.0"
gh repo create stland6338/x-profile-tab-defaults --public --source=. --push
```

- リポジトリの About に説明と `chrome-extension`, `x`, `twitter`, `userscript` のトピック
- PRIVACY.md の URL が掲載情報と一致していることを確認

## 2. zip を作る

```bash
node scripts/build-zip.mjs
```

→ `dist/photos-first-for-x-1.0.0-chrome.zip`（Chrome / Edge 用）と `dist/photos-first-for-x-1.0.0-firefox.zip`（AMO 用）。`store-assets/`, `docs/`, `userscript/`, `.git` は含めない

## 3. Chrome ウェブストア

2026-08-17 実施済み: zip アップロード → 掲載情報（ja/en 説明・画像・URL）→ プライバシー（単一用途・権限理由・リモートコードなし・データ収集なし・ポリシー URL）→ 設定（連絡先メール送信）まで完了。残りはメール確認リンク → 「審査のため送信」。

1. https://chrome.google.com/webstore/devconsole → デベロッパー登録（**$5、1回のみ**。Google アカウントで支払い）
2. 「新しいアイテム」→ zip をアップロード
3. **ストアの掲載情報**: `docs/store-listing.md` からコピペ（ja を既定言語に、en を追加）
4. **プライバシーへの取り組み**: 同ドキュメントの表のとおり回答
5. **配布**: 公開 / 無料 / 全リージョン
6. 「審査のために送信」→ 通常 1〜3 日（長いと 1 週間程度）
7. 公開されたら README の「インストール」にストア URL を追記

## 3b. Firefox（AMO）/ Edge（任意・無料）

- AMO: https://addons.mozilla.org/developers/ → 「新しいアドオンを登録」→ firefox zip → 掲載文は `docs/store-listing.md` の ja/en
- Edge: https://partner.microsoft.com/dashboard/microsoftedge/ → chrome zip をそのまま

## 4. Greasy Fork（任意・即日）

1. https://greasyfork.org でアカウント作成（GitHub ログイン可）
2. 「スクリプトを投稿」→ `userscript/x-tab-defaults.user.js` の内容を貼り付け
3. README にリンクを追記

## 5. 告知

- note / Zenn 記事: 「X のメディア欄が動画デフォになった → 画像デフォに戻す拡張を作った」（仕組み: URL 監視 + popstate、Control Panel for Twitter との違い）
- X で投稿（スクリーンショット 1 を添付）

## 6. 更新時

- `manifest.json` と `userscript/*.user.js` の `version` を上げる → `CHANGELOG.md` に追記 → zip を作り直してアップロード
