#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Java 后端部署脚本（服务器端执行）
# ═══════════════════════════════════════════════════════════
#
# 用法：
#   ./deploy.sh <app-name> [profile]
#
# 示例：
#   ./deploy.sh order-service staging
#   ./deploy.sh order-service production
#
# 该脚本由 speccore deploy 通过 SSH 调用，也可手动在服务器上执行。
# 功能：备份旧 jar → 替换新 jar → 重启 systemd 服务 → 健康检查
# ═══════════════════════════════════════════════════════════

set -euo pipefail

APP_NAME="${1:-}"
PROFILE="${2:-staging}"

if [ -z "$APP_NAME" ]; then
  echo "用法: $0 <app-name> [profile]"
  echo "示例: $0 order-service staging"
  exit 1
fi

DEPLOY_DIR="/opt/services/$APP_NAME"
BACKUP_DIR="$DEPLOY_DIR/backups"
LOG_DIR="/var/log/$APP_NAME"
JAR_FILE="$DEPLOY_DIR/$APP_NAME.jar"
NEW_JAR="$DEPLOY_DIR/$APP_NAME-new.jar"
HEALTH_URL="http://localhost:8080/actuator/health"  # 根据实际端口和路径修改

echo "========================================"
echo "部署应用: $APP_NAME"
echo "环境: $PROFILE"
echo "========================================"

# ── 1. 预检 ──
if [ ! -f "$NEW_JAR" ]; then
  echo "❌ 错误：未找到新 jar 文件: $NEW_JAR"
  echo "   请确保 speccore deploy 已成功上传 jar 到该路径"
  exit 1
fi

# ── 2. 创建必要目录 ──
mkdir -p "$BACKUP_DIR" "$LOG_DIR"

# ── 3. 备份旧版本 ──
if [ -f "$JAR_FILE" ]; then
  BACKUP_NAME="$BACKUP_DIR/$APP_NAME-$(date +%Y%m%d-%H%M%S).jar"
  cp "$JAR_FILE" "$BACKUP_NAME"
  echo "✅ 旧版本已备份: $BACKUP_NAME"

  # 只保留最近 5 个备份
  ls -t "$BACKUP_DIR"/*.jar 2>/dev/null | tail -n +6 | xargs -r rm -f
  echo "🧹 已清理旧备份（保留最近 5 个）"
else
  echo "ℹ️ 首次部署，无旧版本需要备份"
fi

# ── 4. 替换 jar ──
mv "$NEW_JAR" "$JAR_FILE"
echo "✅ 已替换 jar: $JAR_FILE"

# ── 5. 确保 systemd service 文件存在 ──
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"
if [ ! -f "$SERVICE_FILE" ]; then
  echo "⚠️ 警告：systemd service 文件不存在: $SERVICE_FILE"
  echo "   请从 templates/deploy-java/spring-boot.service 复制并修改后部署到该路径"
  echo "   然后执行: sudo systemctl daemon-reload && sudo systemctl enable $APP_NAME"
  exit 1
fi

# ── 6. 重启服务 ──
echo "🔄 重启服务..."
sudo systemctl daemon-reload
sudo systemctl restart "$APP_NAME"

# ── 7. 等待启动 ──
echo "⏳ 等待服务启动（最多 30 秒）..."
for i in {1..30}; do
  sleep 1
  if systemctl is-active --quiet "$APP_NAME"; then
    echo "✅ 服务已启动"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "❌ 服务启动超时"
    echo "📋 日志 tail -n 50:"
    sudo journalctl -u "$APP_NAME" --no-pager -n 50 || true
    exit 1
  fi
done

# ── 8. 健康检查 ──
echo "🏥 执行健康检查..."
for i in {1..10}; do
  sleep 2
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "✅ 健康检查通过: $HEALTH_URL"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "⚠️ 健康检查未通过，但服务已启动"
    echo "   请手动检查: curl $HEALTH_URL"
  fi
done

# ── 9. 显示状态 ──
echo ""
echo "========================================"
echo "📋 部署完成"
echo "========================================"
sudo systemctl status "$APP_NAME" --no-pager || true
echo ""
echo "日志查看:"
echo "  journalctl -u $APP_NAME -f"
echo "  tail -f $LOG_DIR/app.log"
