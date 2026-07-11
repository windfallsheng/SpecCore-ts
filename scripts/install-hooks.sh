#!/bin/bash
# install-hooks.sh - 安装 SpecCore Git Hooks

set -e

GREEN='\033[0;32m'
NC='\033[0m'
print_green() { echo -e "${GREEN}$1${NC}"; }

echo ""
echo "🔧 安装 SpecCore Git Hooks..."

# 创建 .git/hooks 目录
mkdir -p .git/hooks

# 安装 pre-commit hook
ln -sf ../../scripts/git-hooks/pre-commit .git/hooks/pre-commit

# 设置执行权限
chmod +x scripts/git-hooks/pre-commit
chmod +x .git/hooks/pre-commit

echo ""
print_green "✅ Git Hooks 安装完成！"
echo ""
echo "📋 使用说明："
echo "  - 提交代码时自动检查 @spec 注释"
echo "  - 仅警告，不阻断提交（默认模式）"
echo "  - 如需强制检查：export SPEC_STRICT=true"
echo "  - 查看帮助：cat scripts/git-hooks/pre-commit"
