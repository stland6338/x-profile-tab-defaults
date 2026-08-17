#!/usr/bin/env bash
# ランディング＋プライバシーポリシーの静的サイトを Cloudflare Pages にデプロイ
#   ./scripts/deploy-site.sh   → https://photos-first-for-x.pages.dev/
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${PAGES_PROJECT:-photos-first-for-x}"
cp icons/icon128.png site/icon.png
cp store-assets/out/screenshot-1-1280x800.png site/screenshot-1.png
if ! npx --yes wrangler@4 pages project list 2>/dev/null | grep -q "^│ ${PROJECT} "; then
  npx --yes wrangler@4 pages project create "$PROJECT" --production-branch main
fi
npx --yes wrangler@4 pages deploy site --project-name "$PROJECT" --branch main --commit-dirty=true
