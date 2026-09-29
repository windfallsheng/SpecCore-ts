#!/bin/bash
# ═══════════════════════════════════════════════════════════
# Jenkins 构建触发脚本
# ═══════════════════════════════════════════════════════════
# 用途：script 类型部署，触发 Jenkins 任务完成后续构建/发布
# 环境变量：JENKINS_URL / JENKINS_USER / JENKINS_TOKEN
# 用法：./trigger-jenkins.sh <job-name>
# ═══════════════════════════════════════════════════════════
set -euo pipefail

JOB_NAME="${1:-}"

if [ -z "$JOB_NAME" ]; then
  echo "用法: $0 <job-name>"
  exit 1
fi

JENKINS_URL="${JENKINS_URL:-http://jenkins.example.com}"
JENKINS_USER="${JENKINS_USER:-}"
JENKINS_TOKEN="${JENKINS_TOKEN:-}"

echo "🚀 触发 Jenkins: $JOB_NAME"

if [ -n "$JENKINS_USER" ] && [ -n "$JENKINS_TOKEN" ]; then
  curl -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/job/$JOB_NAME/build"
else
  curl -X POST "$JENKINS_URL/job/$JOB_NAME/build"
fi

echo "✅ 已触发（结果请到 Jenkins 控制台查看）"
