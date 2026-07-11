#!/bin/bash
# init-project.sh - 在业务项目中初始化 SpecCore 框架
# 支持国内外所有主流 AI 编程工具
# 用法: 在业务项目根目录执行此脚本

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_green() { echo -e "${GREEN}✅ $1${NC}"; }
print_yellow() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_red() { echo -e "${RED}❌ $1${NC}"; }
print_blue() { echo -e "${BLUE}ℹ️  $1${NC}"; }

SPECCORE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(pwd)"

if [ "$SPECCORE_ROOT" == "$PROJECT_ROOT" ]; then
    print_red "不能在 SpecCore 框架目录中执行此脚本！请在业务项目根目录执行。"
    exit 1
fi

echo ""
echo "=========================================="
echo "  🚀 SpecCore 项目初始化"
echo "=========================================="
echo ""

# 检测 AI 工具
detect_tools() {
    TOOLS=()
    # 国内工具
    [ -d "$PROJECT_ROOT/.codebuddy" ] && TOOLS+=("workbuddy")
    [ -d "$PROJECT_ROOT/.qoder" ] || [ -d "$PROJECT_ROOT/.lingma" ] && TOOLS+=("qcoder")
    [ -d "$PROJECT_ROOT/.trae" ] && TOOLS+=("trae")
    # 国际工具
    [ -d "$PROJECT_ROOT/.cursor" ] && TOOLS+=("cursor")
    [ -d "$PROJECT_ROOT/.claude" ] && TOOLS+=("claude")
    [ -d "$PROJECT_ROOT/.windsurf" ] && TOOLS+=("windsurf")
    [ -d "$PROJECT_ROOT/.gemini" ] && TOOLS+=("gemini")
    [ -d "$PROJECT_ROOT/.opencode" ] && TOOLS+=("opencode")
    
    [ ${#TOOLS[@]} -eq 0 ] && TOOLS=("workbuddy" "trae" "cursor" "claude")
    echo "${TOOLS[@]}"
}

# 工具适配配置
create_symlinks() {
    local tool=$1
    local target_dir=""

    case $tool in
        workbuddy)
            target_dir="$PROJECT_ROOT/.codebuddy"
            mkdir -p "$target_dir/rules"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$target_dir/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$target_dir/"
            ln -sfn "$SPECCORE_ROOT/templates/skills" "$target_dir/skills" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/skills" "$target_dir/"
            cp "$SPECCORE_ROOT/templates/rules/constitution-rule.md" "$target_dir/rules/"
            print_green "workbuddy: 配置完成"
            ;;
        qcoder)
            target_dir="$PROJECT_ROOT/.qoder"
            mkdir -p "$target_dir/rules"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$target_dir/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$target_dir/"
            cp "$SPECCORE_ROOT/templates/rules/constitution-rule.md" "$target_dir/rules/"
            mkdir -p "$PROJECT_ROOT/.lingma"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$PROJECT_ROOT/.lingma/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$PROJECT_ROOT/.lingma/"
            ln -sfn "$SPECCORE_ROOT/templates/skills" "$PROJECT_ROOT/.lingma/skills" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/skills" "$PROJECT_ROOT/.lingma/"
            print_green "qcoder: 配置完成"
            ;;
        trae)
            target_dir="$PROJECT_ROOT/.trae"
            mkdir -p "$target_dir/rules"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$target_dir/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$target_dir/"
            ln -sfn "$SPECCORE_ROOT/templates/skills" "$target_dir/skills" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/skills" "$target_dir/"
            cp "$SPECCORE_ROOT/templates/rules/constitution-rule.md" "$target_dir/rules/"
            print_green "trae: 配置完成"
            ;;
        cursor)
            target_dir="$PROJECT_ROOT/.cursor"
            mkdir -p "$target_dir"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$target_dir/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$target_dir/"
            print_green "cursor: 配置完成"
            ;;
        claude)
            target_dir="$PROJECT_ROOT/.claude"
            mkdir -p "$target_dir"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$target_dir/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$target_dir/"
            print_green "claude: 配置完成"
            ;;
        windsurf)
            target_dir="$PROJECT_ROOT/.windsurf"
            mkdir -p "$target_dir"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$target_dir/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$target_dir/"
            print_green "windsurf: 配置完成"
            ;;
        gemini)
            target_dir="$PROJECT_ROOT/.gemini"
            mkdir -p "$target_dir"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$target_dir/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$target_dir/"
            print_green "gemini: 配置完成"
            ;;
        opencode)
            target_dir="$PROJECT_ROOT/.opencode"
            mkdir -p "$target_dir"
            ln -sfn "$SPECCORE_ROOT/templates/commands" "$target_dir/commands" 2>/dev/null || cp -r "$SPECCORE_ROOT/templates/commands" "$target_dir/"
            print_green "opencode: 配置完成"
            ;;
    esac
}

TOOLS=($(detect_tools))
echo "🔧 检测到工具: ${TOOLS[*]}"
echo ""

for tool in "${TOOLS[@]}"; do
    create_symlinks "$tool"
done

# 拷贝 Spec 模板
if [ ! -d "$PROJECT_ROOT/.speccore" ]; then
    cp -r "$SPECCORE_ROOT/templates/spec/.speccore" "$PROJECT_ROOT/"
    print_green "已创建 .speccore/ 目录"
else
    print_yellow ".speccore/ 已存在，跳过"
fi

if [ ! -d "$PROJECT_ROOT/期次-示例" ]; then
    cp -r "$SPECCORE_ROOT/templates/spec/期次-示例" "$PROJECT_ROOT/"
    print_green "已创建 期次-示例/ 目录"
else
    print_yellow "期次-示例/ 已存在，跳过"
fi

# 生成 .gitignore
if ! grep -q ".speccore/local/" "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
    echo "" >> "$PROJECT_ROOT/.gitignore"
    echo "# SpecCore 本地配置" >> "$PROJECT_ROOT/.gitignore"
    echo ".speccore/local/" >> "$PROJECT_ROOT/.gitignore"
    echo "期次-*/.local/" >> "$PROJECT_ROOT/.gitignore"
    print_green "已更新 .gitignore"
fi

# 生成 README（如果不存在）
if [ ! -f "$PROJECT_ROOT/README.md" ]; then
    cat > "$PROJECT_ROOT/README.md" << 'EOF'
# 项目名称

> 基于 SpecCore 框架开发

## 快速开始
1. `/spec-iteration-create --name=期次名称` - 创建期次
2. 编辑 `00-需求文档/REQUIREMENT.md` 填写需求
3. `/spec-iteration-split` - 自动拆分 Task
4. `/spec-plan --team=3` - 生成调度方案
5. `@task-backend-dev 开发 Task-001` - 开始开发
6. `/spec-review Task-001` - 审查产出
7. `/spec-archive --all` - 归档已完成 Task

## 相关文档
- [SpecCore 框架文档](https://gitee.com/windfullsheng/spec-core)
EOF
    print_green "已生成 README.md"
fi

# 创建模板库目录
if [ -d "$PROJECT_ROOT/.speccore/PATTERNS" ] && [ ! -d "$PROJECT_ROOT/.speccore/PATTERNS/TEMPLATES" ]; then
    mkdir -p "$PROJECT_ROOT/.speccore/PATTERNS/TEMPLATES/crud"
    mkdir -p "$PROJECT_ROOT/.speccore/PATTERNS/TEMPLATES/auth"
    mkdir -p "$PROJECT_ROOT/.speccore/PATTERNS/TEMPLATES/export"
    mkdir -p "$PROJECT_ROOT/.speccore/PATTERNS/TEMPLATES/report"
    print_green "已创建模板库目录"
fi

# 创建本地配置目录
mkdir -p "$PROJECT_ROOT/.speccore/local"

# 创建 context.json
if [ ! -f "$PROJECT_ROOT/.speccore/local/context.json" ]; then
    cp "$SPECCORE_ROOT/templates/spec/.speccore/local/context.json" "$PROJECT_ROOT/.speccore/local/context.json"
    print_green "已创建 context.json"
fi

# 创建 GLOBAL 全量层目录结构
if [ ! -d "$PROJECT_ROOT/.speccore/GLOBAL" ]; then
    mkdir -p "$PROJECT_ROOT/.speccore/GLOBAL"
    mkdir -p "$PROJECT_ROOT/.speccore/GLOBAL/PROJECTS/_template"
    for f in "$SPECCORE_ROOT/templates/spec/.speccore/GLOBAL"/*.md; do
        [ -f "$f" ] && cp "$f" "$PROJECT_ROOT/.speccore/GLOBAL/"
    done
    cp "$SPECCORE_ROOT/templates/spec/.speccore/GLOBAL/PROJECTS/_template/"*.md "$PROJECT_ROOT/.speccore/GLOBAL/PROJECTS/_template/" 2>/dev/null || true
    print_green "已创建 GLOBAL/ 全量层目录"
fi

# 创建平台配置
if [ ! -d "$PROJECT_ROOT/.speccore/config" ]; then
    mkdir -p "$PROJECT_ROOT/.speccore/config"
fi
if [ ! -f "$PROJECT_ROOT/.speccore/config/platforms.yaml" ]; then
    cp "$SPECCORE_ROOT/templates/spec/.speccore/config/platforms.yaml" "$PROJECT_ROOT/.speccore/config/"
    print_green "已创建平台配置 platforms.yaml"
fi

# 创建 Codex 同步脚本
if command -v codex &> /dev/null; then
    cat > "$PROJECT_ROOT/scripts/sync-codex.sh" << 'CODEX'
#!/bin/bash
# 同步 SpecCore 命令到 Codex
mkdir -p ~/.codex/prompts
cp .codebuddy/commands/spec-*.md ~/.codex/prompts/
echo "✅ Codex 命令已同步"
CODEX
    chmod +x "$PROJECT_ROOT/scripts/sync-codex.sh"
    print_green "Codex 同步脚本已生成"
fi

echo ""
echo "=========================================="
print_green "🎉 SpecCore 框架初始化完成！"
echo "=========================================="
echo ""
echo "📋 下一步："
echo "  1. 编辑 .speccore/CONSTITUTION.md 填写技术栈"
echo "  2. 编辑 .speccore/config/platforms.yaml 配置平台"
echo "  3. 首次使用？运行 /spec-welcome 体验引导模式"
echo "  4. 快速体验？运行 /spec-demo 查看示例项目"
echo "  5. 从零开始：/spec-iteration-create --name=2026-07-xxx"
echo ""
echo "🛠️  适配的工具："
echo "  ${TOOLS[*]}"
echo "  （支持 36 个命令 + 意图识别引擎）"
echo ""
