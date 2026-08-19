# Changelog

## 1.0.1 — 2026-08-19

- フェイルセーフを追加: 書き換え先を X が「このページは存在しません」と返した場合、元の URL に戻してその種類（ポスト／メディア）の書き換えを 30 分止める（x.com の `localStorage` にフラグ `xtd:broken` を保存）。X の URL 仕様が変わっても害を出さず「何もしない」に倒れる。元の URL でも同じエラーなら拡張のせいではないと判断して解除する
- E2E: フェイルセーフを CDP で応答を差し替えた「偽 X」で決定的に検証。Linux（GitHub Actions）でも動くように Chromium の探索先を追加。X に到達できないときは exit 2（失敗扱いにしない）
- GitHub Actions `weekly-e2e`: 毎週月曜に本物の x.com に対して E2E を回し、壊れていたら Issue を自動起票
- ユーザースクリプト版にも同じフェイルセーフを追加（1.0.1）
- 開発: 共通ロジックは page.js を正本にし `scripts/sync-userscript.mjs` で userscript に生成（`--check` で乖離検出）。`scripts/check-version.mjs` で manifest / userscript / CHANGELOG のバージョン一致を確認。どちらも build-zip と CI が実行
- 開発: E2E の対象を消えにくい @X / @Support に変更。CI は失敗時 1 回リトライ、Playwright と actions のバージョンを固定。引退手順を docs/sunset.md に記載

## 1.0.0 — 2026-08-17

- 初回リリース
- プロフィールを開いたときに ポスト▼ →「すべて」、メディア▼ →「画像」へ自動切替（リロードなし）
- 設定画面（動作モード 固定／記憶、すべて／変更しない、画像／変更しない、手動選択の尊重）
- Firefox 用 zip（AMO）／ Edge は Chrome 用 zip を共用
- 日本語 / 英語
- ユーザースクリプト版（`userscript/x-tab-defaults.user.js`）
