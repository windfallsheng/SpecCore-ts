#!/bin/bash
# ═══════════════════════════════════════════════════════════
# FTP 上传部署脚本（lftp）
# ═══════════════════════════════════════════════════════════
# 用途：script 类型部署，无 SSH 权限只有 FTP 的虚拟主机场景
# 环境变量（由用户 shell 环境注入，勿写入 git）：
#   FTP_USER / FTP_PASS / FTP_HOST / FTP_REMOTE_DIR
# 用法：FTP_USER=u FTP_PASS=p FTP_HOST=h ./deploy-ftp.sh [本地目录]
# ═══════════════════════════════════════════════════════════
set -euo pipefail

LOCAL_DIR="${1:-dist}"
FTP_REMOTE_DIR="${FTP_REMOTE_DIR:-/public_html}"

if [ -z "${FTP_USER:-}" ] || [ -z "${FTP_PASS:-}" ] || [ -z "${FTP_HOST:-}" ]; then
  echo "❌ 缺少环境变量: FTP_USER / FTP_PASS / FTP_HOST"
  exit 1
fi

echo "🚀 FTP 上传: $LOCAL_DIR → $FTP_HOST:$FTP_REMOTE_DIR"

lftp -u "$FTP_USER,$FTP_PASS" "$FTP_HOST" <<INNER_EOF
set ssl:verify-certificate no
mirror -R "$LOCAL_DIR" "$FTP_REMOTE_DIR"
bye
INNER_EOF

echo "✅ 上传完成"
