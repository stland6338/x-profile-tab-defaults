# 引退手順（X が公式に「表示タブを固定する設定」を出したとき）

この拡張は「X が本来やるべきこと」の代替なので、X 側で解決したら静かに引退させる。
方針: **リモートで止めない**（「通信なし」の約束を守る）。最終版を配信して、ストアから取り下げる。

## 1. 最終版（no-op）を出す

1. `page.js` の `applyConfig()` 冒頭で何もせず return するようにし、`options.html` の先頭に
   「X が公式に対応したため、この拡張は不要になりました。アンインストールしてください」を ja/en で表示する
   （`_locales/*/messages.json` に `sunsetNotice` を追加）
2. `node scripts/sync-userscript.mjs`（userscript も同じく no-op に）
3. version を上げる（例 `1.9.0`）→ CHANGELOG に「役目終了」→ `node scripts/build-zip.mjs`
4. Chrome ウェブストアへアップロード → 審査 → 公開（利用者の Chrome は数時間〜数日で自動更新される）

## 2. ストアから取り下げる（公開から 2〜4 週間後）

- ダッシュボード → アイテム → 「公開を停止」（削除ではなく非公開。既存ユーザーには残る）
- ストア掲載文は非公開前に「X が公式対応したため配布終了」に差し替えておく

## 3. 周辺を片付ける

- README 冒頭に「**役目終了（YYYY-MM-DD）** — X の公式設定を使ってください」を追記。リポジトリを Archive
- `site/index.html` の「Chrome ウェブストアで入手」を「配布終了」に → `./scripts/deploy-site.sh`
- GitHub Actions `weekly-e2e` を止める（`.github/workflows/e2e-weekly.yml` を削除するか、Actions を無効化）
- Cloudflare Pages はプライバシーポリシー URL を残す必要があるため、当面はそのまま（費用ゼロ）

## 途中で壊れたが直す気力がないとき

同じ手順で「X の仕様変更により動作しなくなりました。修正予定はありません」の最終版を出してから取り下げる。
黙って放置するより、利用者に一言伝えて消えるほうがよい。
