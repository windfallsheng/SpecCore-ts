#!/bin/bash
# sync-framework.sh - 更新业务项目中的框架文件
# 用法: 在业务项目根目录执行此脚本

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_green() { echo -e "${GREEN}✅ $1${NC}"; }
print_yellow() { echo -e "${YELLOW}⚠️  $1${NC}"; }

SPECCORE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(pwd)"

echo "🔄 同步 SpecCore 框架更新..."

for tool in workbuddy qcoder trae; do
    case $tool in
        workbuddy) dir=".codebuddy" ;;
        qcoder) dir=".qoder" ;;
        trae) dir=".trae" ;;
    esac

    if [ -d "$dir" ]; then
        if [ -L "$dir/commands" ]; then
            rm "$dir/commands"
            ln -sf "$SPECCORE_ROOT/templates/commands" "$dir/commands"
            print_green "$tool: commands 已更新"
        fi
        if [ -L "$dir/skills" ]; then
            rm "$dir/skills"
            ln -sf "$SPECCORE_ROOT/templates/skills" "$dir/skills"
            print_green "$tool: skills 已更新"
        fi
        if [ -d "$dir/rules" ]; then
            cp "$SPECCORE_ROOT/templates/rules/constitution-rule.md" "$dir/rules/"
            print_green "$tool: rules 已更新"
        fi
    fi
done

# 更新 .speccore 模板
if [ -d "$PROJECT_ROOT/.speccore" ] && [ ! -L "$PROJECT_ROOT/.speccore" ]; then
    print_yellow ".speccore/ 已存在，请手动合并更新"
else
    cp -r "$SPECCORE_ROOT/templates/spec/.speccore" "$PROJECT_ROOT/"
    print_green ".speccore/ 已更新"
fi

print_green "框架同步完成！"
