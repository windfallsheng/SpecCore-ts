#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Docker 远程部署脚本（服务器端执行）
# ═══════════════════════════════════════════════════════════
#
# 用法：
#   ./deploy-remote.sh <image> <container-name> [run-args]
#
# 示例：
#   ./deploy-remote.sh registry.example.com/order-service:staging order-service "-p 8080:8080 -e SPRING_PROFILES_ACTIVE=staging"
#
# 该脚本用于服务器端手动更新容器，也可作为 speccore deploy script 的远程命令。
# ═══════════════════════════════════════════════════════════

set -euo pipefail

IMAGE="${1:-}"
NAME="${2:-}"
RUN_ARGS="${3:-}"

if [ -z "$IMAGE" ] || [ -z "$NAME" ]; then
  echo "用法: $0 <image> <container-name> [run-args]"
  echo "示例: $0 registry.example.com/order-service:staging order-service \"-p 8080:8080\""
  exit 1
fi

echo "========================================"
echo "Docker 远程部署"
echo "镜像: $IMAGE"
echo "容器: $NAME"
echo "========================================"

# ── 1. 拉取最新镜像 ──
echo "📥 拉取镜像..."
docker pull "$IMAGE"

# ── 2. 停止并删除旧容器 ──
if docker ps -a --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "🛑 停止旧容器: $NAME"
  docker stop "$NAME" || true
  echo "🗑️  删除旧容器: $NAME"
  docker rm "$NAME" || true
else
  echo "ℹ️ 无旧容器需要清理"
fi

# ── 3. 清理旧镜像（保留最近 3 个标签） ──
echo "🧹 清理旧镜像..."
IMAGE_BASE=$(echo "$IMAGE" | cut -d: -f1)
docker images "$IMAGE_BASE" --format '{{.Repository}}:{{.Tag}}' | tail -n +4 | xargs -r docker rmi || true

# ── 4. 启动新容器 ──
echo "🚀 启动新容器..."
if [ -n "$RUN_ARGS" ]; then
  # shellcheck disable=SC2086
  docker run -d --name "$NAME" --restart always $RUN_ARGS "$IMAGE"
else
  docker run -d --name "$NAME" --restart always "$IMAGE"
fi

# ── 5. 等待并检查状态 ──
echo "⏳ 等待容器启动..."
sleep 3

if docker ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "✅ 容器已启动: $NAME"
else
  echo "❌ 容器启动失败"
  echo "📋 日志:"
  docker logs "$NAME" --tail 50 || true
  exit 1
fi

# ── 6. 显示状态 ──
echo ""
echo "========================================"
echo "📋 部署完成"
echo "========================================"
docker ps --filter "name=$NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
