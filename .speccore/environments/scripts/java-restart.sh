#!/bin/bash
# =============================================================================
# Java 服务远程重启脚本
# =============================================================================
# 用途：ssh 类型部署时作为 script 字段使用，自动停止→替换→启动
# 位置：.speccore/environments/scripts/java-restart.sh
# 执行：由 deploy engine 通过 ssh 在远程服务器上执行
#
# 环境变量（由 deploy engine 自动注入）：
#   $PLATFORM    当前端名（如 order-api）
#   $ENV         当前环境（如 staging, production）
# =============================================================================

set -e

SERVICE_NAME="${PLATFORM:-order-api}"
REMOTE_DIR="/opt/services/$SERVICE_NAME"
JAR_FILE="$REMOTE_DIR/app.jar"

echo "🛑 停止服务: $SERVICE_NAME"
sudo systemctl stop "$SERVICE_NAME" || true

echo "📦 更新 jar 包"
# deploy engine 已通过 scp 上传新 jar 到 $REMOTE_DIR/，这里只需改名
cp "$REMOTE_DIR"/*.jar "$JAR_FILE"

echo "🚀 启动服务: $SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

echo "⏳ 等待服务健康检查..."
sleep 5
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "✅ 服务启动成功: $SERVICE_NAME"
else
  echo "❌ 服务启动失败，查看日志:"
  sudo journalctl -u "$SERVICE_NAME" --no-pager -n 20
  exit 1
fi
