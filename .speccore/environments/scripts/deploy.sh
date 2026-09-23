#!/bin/bash
# =============================================================================
# SpecCore 通用部署脚本模板
# =============================================================================
# 用途：自定义部署逻辑（script 类型部署时调用）
# 位置：.speccore/environments/scripts/deploy.sh
# 执行：speccore deploy --env <env> --platform <platform>
#
# 环境变量（由 deploy engine 自动注入）：
#   $PLATFORM    当前端名（如 notification-service）
#   $ENV         当前环境（如 staging, production）
#   $CWD         端代码路径（code_path 或项目根目录）
# =============================================================================

set -e

echo "🚀 开始部署: $PLATFORM → $ENV"
echo "📂 工作目录: $CWD"

# TODO: 在此添加自定义部署逻辑
# 示例：
# cd "$CWD"
# tar -czf dist.tar.gz dist/
# scp dist.tar.gz deploy@server:/opt/services/$PLATFORM/
# ssh deploy@server "cd /opt/services/$PLATFORM && tar -xzf dist.tar.gz && sudo systemctl restart $PLATFORM"

echo "✅ 部署完成: $PLATFORM → $ENV"
