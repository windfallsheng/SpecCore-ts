#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Python 服务部署脚本（gunicorn + systemd）
# ═══════════════════════════════════════════════════════════
# 用途：script 类型部署，上传打包产物并重启 gunicorn 服务
# 环境变量：
#   DEPLOY_HOST    服务器地址（user@host）
#   DEPLOY_DIR     服务器部署目录（默认 /opt/services/api）
#   SERVICE_NAME   systemd 服务名（默认 api-gunicorn）
# 用法：./deploy-python.sh [本地产物目录]
# ═══════════════════════════════════════════════════════════
set -euo pipefail

LOCAL_DIR="${1:-dist}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/services/api}"
SERVICE_NAME="${SERVICE_NAME:-api-gunicorn}"

if [ -z "$DEPLOY_HOST" ]; then
  echo "❌ 缺少环境变量: DEPLOY_HOST（格式 user@host）"
  exit 1
fi

echo "🚀 Python 部署: $LOCAL_DIR → $DEPLOY_HOST:$DEPLOY_DIR"

rsync -az --delete "$LOCAL_DIR"/ "$DEPLOY_HOST:$DEPLOY_DIR/app/"
ssh "$DEPLOY_HOST" "sudo systemctl restart $SERVICE_NAME"
ssh "$DEPLOY_HOST" "sudo systemctl status $SERVICE_NAME --no-pager"

echo "✅ 部署完成"
