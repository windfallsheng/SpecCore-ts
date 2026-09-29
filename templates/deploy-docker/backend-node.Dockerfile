# ═══════════════════════════════════════════════════════════
# Node.js 后端 Docker 多阶段构建示例（Express / NestJS / Koa）
# ═══════════════════════════════════════════════════════════
#
# 用法：
#   1. 将本文件复制到后端工程根目录，重命名为 Dockerfile
#   2. 在 PROJECT.yaml 中配置 docker 类型部署：
#        type: docker
#        dockerfile: ./Dockerfile
#        registry: <镜像仓库>
#        image: <镜像名>
#        tag: staging
#   3. 执行: speccore deploy --env staging --platform <后端端名>
#
# 多阶段构建：Node 编译 → 精简运行镜像
# ═══════════════════════════════════════════════════════════

# ── 阶段 1：依赖安装 + 构建 ──
FROM node:20-alpine AS builder
WORKDIR /app

# 先复制依赖文件（利用 Docker 缓存层）
COPY package*.json ./
RUN npm ci

# 复制源码并构建
COPY . .
RUN npm run build

# ── 阶段 2：运行（只装生产依赖，镜像更小）──
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# 复制依赖与构建产物
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# 非 root 用户运行（安全最佳实践）
RUN addgroup -S app && adduser -S app -G app
USER app

# 健康检查（按实际端口调整，Express 项目可用 /healthz 路由）
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

EXPOSE 3000

# 启动命令（按实际入口调整，如 dist/main.js、dist/server.js）
CMD ["node", "dist/main.js"]
