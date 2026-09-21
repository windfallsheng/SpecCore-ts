#!/bin/bash
# speccore 发布脚本 — beta/latest 两段式发布策略（v8.3.211+）
#
# 用法:
#   ./scripts/release.sh verify   本地验证（build + dist 冒烟 + npm pack 检查），不发布
#   ./scripts/release.sh beta     发布 beta 版（开发期，不影响 latest）
#   ./scripts/release.sh stable   发布稳定版（latest + stable tag）
#
# 发布节奏:
#   开发期   → release.sh beta   （npm i -g speccore@beta 验证）
#   验证通过 → release.sh stable （latest + stable 指向它，用户默认拿到）
set -e

MODE="${1:-verify}"
VERSION=$(node -p "require('./package.json').version")
PKG="speccore"

log() { echo -e "\n\033[1;36m[$MODE]\033[0m $*"; }

case "$MODE" in
  verify)
    log "本地验证 $PKG@$VERSION（不发布）"
    log "1/3 构建..."
    npm run build
    log "2/3 构建产物冒烟测试..."
    node dist/cli.js --version
    log "3/3 npm pack 检查包内容（files 字段是否正确）..."
    npm pack --dry-run 2>&1 | grep -E "Tarball Contents|total files|dist/|bin/|\.agents/|package size" | head -30 || true
    echo ""
    echo "✅ 本地验证通过。确认无误后:"
    echo "   ./scripts/release.sh beta     # 发 beta 给用户验证"
    echo "   ./scripts/release.sh stable   # 验证通过后推 latest + stable"
    ;;
  beta)
    log "发布 beta 版 $PKG@$VERSION"
    npm run build
    npm publish --tag beta
    echo ""
    echo "✅ 已发布 beta（latest 未动）。用户验证:"
    echo "   npm i -g speccore@beta"
    echo "   which speccore && speccore --version"
    echo "   验证通过后: ./scripts/release.sh stable"
    ;;
  stable)
    log "发布稳定版 $PKG@$VERSION（latest + stable）"
    npm run build
    npm publish
    npm dist-tag add "$PKG@$VERSION" stable
    echo ""
    echo "✅ 已发布 latest + stable = $VERSION"
    echo "   用户默认: npm i -g speccore@latest"
    ;;
  *)
    echo "用法: $0 {verify|beta|stable}"
    echo "  verify  本地验证（build + 冒烟 + pack 检查）"
    echo "  beta    发 beta 版（开发期）"
    echo "  stable  发稳定版（latest + stable tag）"
    exit 1
    ;;
esac
