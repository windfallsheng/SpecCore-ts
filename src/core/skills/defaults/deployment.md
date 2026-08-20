---
tags:
  - deploy
  - deployment
  - ci-cd
  - vercel
  - aws
  - docker
---

# 部署技能

## 通用原则

1. **蓝绿部署**：生产环境使用蓝绿部署，零停机切换
2. **回滚策略**：每个版本保留回滚能力（保留最近 3 个版本）
3. **健康检查**：部署后自动执行健康检查，失败自动回滚
4. **灰度发布**：新功能先灰度 5% → 20% → 50% → 100%

## Docker 部署

```dockerfile
# 多阶段构建
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

## CI/CD 流水线

```yaml
# 标准流水线
stages:
  - lint
  - test
  - build
  - deploy-staging
  - deploy-production
```
