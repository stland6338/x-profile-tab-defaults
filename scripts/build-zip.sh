#!/usr/bin/env bash
# Chrome ウェブストア提出用の zip を作る
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/x-tab-defaults-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js bridge.js page.js \
  options.html options.css options.js \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  _locales \
  -x '*.DS_Store' -x '*/.claude/*'

echo "wrote $OUT"
unzip -l "$OUT"
