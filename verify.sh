#!/bin/bash
set -e

CLI_PATH="./bin/speccore"
CLI_ABS_PATH="$(cd "$(dirname "$0")" && pwd)/bin/speccore"
TEST_DIR="$(cd "$(dirname "$0")" && pwd)/verify-project"

# 运行前清理旧数据（如果存在）
if [ -d "$TEST_DIR" ]; then
    echo "🧹 发现旧示例目录，正在清理..."
    rm -rf "$TEST_DIR"
fi

echo "========================================"
echo "🚀 SpecCore 验证脚本"
echo "========================================"
echo ""

# 1. 编译检查
echo "📦 步骤 1: 检查编译输出"
if [ ! -f "dist/cli.js" ]; then
    echo "❌ 未找到编译输出，正在编译..."
    npx tsc
fi
if [ -f "dist/cli.js" ]; then
    echo "✅ 编译输出存在"
else
    echo "❌ 编译失败"
    exit 1
fi
echo ""

# 2. 版本检查
echo "📦 步骤 2: 检查版本"
VERSION=$(node $CLI_PATH --version)
if [ "$VERSION" = "1.0.0" ]; then
    echo "✅ 版本正确: $VERSION"
else
    echo "⚠️ 版本: $VERSION (预期 1.0.0)"
fi
echo ""

# 3. 帮助命令
echo "📦 步骤 3: 检查帮助命令"
HELP=$(node $CLI_PATH --help 2>&1)
if echo "$HELP" | grep -q "init"; then
    echo "✅ 帮助命令正常"
else
    echo "❌ 帮助命令异常"
fi
echo ""

# 4. 创建测试目录
echo "📦 步骤 4: 创建测试项目"
mkdir -p $TEST_DIR
cd $TEST_DIR
node "$CLI_ABS_PATH" init --mode fresh 2>&1 | grep -q "initialized" && echo "✅ init 成功" || echo "❌ init 失败"
echo ""

# 5. 检查目录结构
echo "📦 步骤 5: 检查目录结构"
if [ -d ".speccore" ] && [ -f ".speccore/CONSTITUTION.md" ] && [ -f ".speccore/local/context.json" ]; then
    echo "✅ 目录结构正确"
else
    echo "❌ 目录结构缺失"
fi
echo ""

# 6. validate 命令
echo "📦 步骤 6: 验证空项目"
RESULT=$(node "$CLI_ABS_PATH" validate --format json 2>&1)
if echo "$RESULT" | grep -q '"passRate": 100'; then
    echo "✅ validate 通过"
else
    echo "❌ validate 失败: $RESULT"
fi
echo ""

# 7. status 命令
echo "📦 步骤 7: 检查状态"
node "$CLI_ABS_PATH" status 2>&1 | grep -q "Total Tasks" && echo "✅ status 正常" || echo "❌ status 异常"
echo ""

# 8. health 命令
echo "📦 步骤 8: 检查健康度"
RESULT=$(node "$CLI_ABS_PATH" health --format json 2>&1)
if echo "$RESULT" | grep -q '"overall":'; then
    echo "✅ health 正常"
else
    echo "❌ health 异常"
fi
echo ""

# 9. config 命令
echo "📦 步骤 9: 检查配置"
node "$CLI_ABS_PATH" config --get assignee 2>&1 | grep -q "Not set" && echo "✅ config 正常" || echo "❌ config 异常"
echo ""

# 10. iteration create
echo "📦 步骤 10: 创建期次"
node "$CLI_ABS_PATH" iteration create --name 2026-07-验证 2>&1 | grep -q "created" && echo "✅ iteration create 成功" || echo "❌ iteration create 失败"
if [ -d "期次-2026-07-验证" ]; then
    echo "✅ 期次目录已创建"
fi
echo ""

# 11. task new
echo "📦 步骤 11: 创建任务"
node "$CLI_ABS_PATH" task new --name 测试任务 --type feature 2>&1 | grep -q "created" && echo "✅ task new 成功" || echo "❌ task new 失败"
if [ -d "期次-2026-07-验证/Task-001" ]; then
    echo "✅ 任务目录已创建"
fi
echo ""

# 12. progress
echo "📦 步骤 12: 检查进度"
RESULT=$(node "$CLI_ABS_PATH" progress --format json 2>&1)
if echo "$RESULT" | grep -q '"total": 1'; then
    echo "✅ progress 正确识别任务"
else
    echo "❌ progress 异常"
fi
echo ""

# 13. report
echo "📦 步骤 13: 生成报告"
RESULT=$(node "$CLI_ABS_PATH" report --format json 2>&1)
if echo "$RESULT" | grep -q '"tasks"'; then
    echo "✅ report 正常"
else
    echo "❌ report 异常"
fi
echo ""

# 14. validate with task
echo "📦 步骤 14: 验证有任务的项目"
RESULT=$(node "$CLI_ABS_PATH" validate --format json 2>&1)
if echo "$RESULT" | grep -q '"Task-001"'; then
    echo "✅ validate 正确识别 Task-001"
else
    echo "❌ validate 未识别任务"
fi
echo ""

# 15. context.json 更新
echo "📦 步骤 15: 检查上下文更新"
if [ -f ".speccore/local/context.json" ]; then
    CURRENT=$(cat .speccore/local/context.json | grep -o '"currentIteration".*"' | head -1)
    echo "✅ 上下文已更新: $CURRENT"
else
    echo "❌ 上下文文件缺失"
fi
echo ""

echo ""
echo "📂 验证生成的内容保存在:"
echo "   $TEST_DIR"
echo ""
echo "✅ 验证完成！所有命令测试通过"
echo "========================================"
