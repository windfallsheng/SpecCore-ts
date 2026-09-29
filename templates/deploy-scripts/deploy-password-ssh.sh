#!/bin/bash
# ═══════════════════════════════════════════════════════════
# 密码认证 SSH 部署脚本（sshpass）
# ═══════════════════════════════════════════════════════════
# 用途：script 类型部署，无密钥只有密码的 SSH 场景
# 前置：安装 sshpass（macOS: brew install sshpass；Ubuntu: apt-get install sshpass）
# 环境变量（由用户 shell 环境注入，勿写入 git）：
#   SSH_USER / SSH_PASSWORD / SSH_HOST / SSH_REMOTE_DIR
# 用法：SSH_USER=u SSH_PASSWORD=p ./deploy-password-ssh.sh [本地目录]
# ═══════════════════════════════════════════════════════════
set -euo pipefail

LOCAL_DIR="${1:-dist}"
SSH_REMOTE_DIR="${SSH_REMOTE_DIR:-/var/www/html}"

if [ -z "${SSH_USER:-}" ] || [ -z "${SSH_PASSWORD:-}" ] || [ -z "${SSH_HOST:-}" ]; then
  echo "❌ 缺少环境变量: SSH_USER / SSH_PASSWORD / SSH_HOST"
  exit 1
fi

echo "🚀 SSH 上传: $LOCAL_DIR → $SSH_USER@$SSH_HOST:$SSH_REMOTE_DIR"

sshpass -p "$SSH_PASSWORD" scp -r "$LOCAL_DIR"/* "$SSH_USER@$SSH_HOST:$SSH_REMOTE_DIR/"
sshpass -p "$SSH_PASSWORD" ssh "$SSH_USER@$SSH_HOST" "sudo nginx -s reload"

echo "✅ 部署完成"
