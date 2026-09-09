# ═══════════════════════════════════════════════════════════
# 前端 Docker 构建示例（Nginx 多阶段构建）
# ═══════════════════════════════════════════════════════════
#
# 用法：
#   1. 将本文件复制到前端工程根目录
#   2. 如有自定义 nginx 配置，一并复制 nginx.conf 到同目录
#   3. 在 PROJECT.yaml 中配置 docker 类型部署
#   4. 执行: speccore deploy --env staging --platform admin-web
#
# 多阶段构建：Node 编译 → Nginx 托管静态资源
# ═══════════════════════════════════════════════════════════

# ── 阶段 1：构建 ──
FROM node:18-alpine AS builder
WORKDIR /app

# 先复制依赖文件（利用 Docker 缓存层）
COPY package*.json ./
RUN npm ci

# 复制源码并构建
COPY . .
ARG BUILD_ENV=staging
RUN npm run build:$BUILD_ENV

# ── 阶段 2：运行 ──
FROM nginx:alpine
WORKDIR /usr/share/nginx/html

# 复制构建产物
COPY --from=builder /app/dist .

# 复制自定义 nginx 配置（可选，没有则使用 Nginx 默认配置）
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
