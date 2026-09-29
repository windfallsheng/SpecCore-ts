#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Docker Compose 部署脚本（服务器端执行）
# ═══════════════════════════════════════════════════════════
# 用途：script 类型部署，服务器端统一拉取并启动前后端编排
# 用法：./deploy-compose.sh [compose-file]
# 示例：./deploy-compose.sh /opt/deploy/docker-compose.yml
# ═══════════════════════════════════════════════════════════
set -euo pipefail

COMPOSE_FILE="${1:-/opt/deploy/docker-compose.yml}"

echo "🚀 Compose 部署: $COMPOSE_FILE"
docker-compose -f "$COMPOSE_FILE" pull
docker-compose -f "$COMPOSE_FILE" up -d

echo "📋 运行状态:"
docker-compose -f "$COMPOSE_FILE" ps
echo "✅ 部署完成"
