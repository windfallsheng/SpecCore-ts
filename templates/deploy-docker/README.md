# Docker 部署指南

> 本目录提供前后端 Docker 部署的模板和示例，涵盖本地构建、镜像仓库推送、远程服务器拉取运行全流程。

---

## 目录结构

```
deploy-docker/
├── frontend.Dockerfile      # 前端 Nginx 多阶段构建示例
├── nginx.conf               # Nginx 自定义配置（SPA 路由 + API 代理 + 静态缓存）
├── docker-compose.yml       # 前后端 + MySQL + Redis 编排示例
├── deploy-remote.sh         # 服务器端 Docker 部署脚本
└── README.md                # 本文件
```

---

## 核心问题解答

### Q1: Docker 部署是否需要上传文件？

**不需要传统意义上的 SCP 文件上传**，但有三种等价的"文件传输"方式：

| 方式 | 说明 | 适用场景 |
|------|------|----------|
| **镜像仓库**（推荐） | `docker build` → `docker push` → 远程 `docker pull` | 有私有 registry（Harbor/Nexus/阿里云 ACR） |
| **docker save + scp** | `docker save` 导出 tar → scp 到服务器 → `docker load` | 无 registry 的内网环境 |
| **远程 build** | SSH 到服务器，在服务器上 `docker build` | 服务器性能强于本地 |

speccore `docker` 类型默认采用**镜像仓库方式**（推荐）。

### Q2: 远程服务器上如何部署？

speccore `docker` 类型现已支持 `host` 字段，部署流程如下：

```yaml
deploy:
  staging:
    type: docker
    dockerfile: ./Dockerfile
    registry: registry.example.com      # 镜像仓库（远程部署必填）
    image: my-project/order-service
    tag: staging
    host: deployer@staging-server.com   # 远程服务器（新增支持）
    key: ~/.ssh/id_rsa
    # script: 自定义远程命令（可选，默认执行 pull → stop → rm → run）
```

执行流程：
1. **本地** `docker build`
2. **本地** `docker push registry.example.com/my-project/order-service:staging`
3. **SSH 远程** `docker pull && docker stop && docker rm && docker run`

### Q3: 前端 + 后端都有 Docker，怎么一起部署？

**方式 A：分别部署（推荐，解耦前后端发布节奏）**

```yaml
# PROJECT.yaml
platforms:
  - name: admin-web
    type: frontend
    code_path: ./admin-web
    deploy:
      staging:
        type: docker
        dockerfile: ./Dockerfile
        registry: registry.example.com
        image: my-project/admin-web
        tag: staging
        host: deployer@staging-server.com
        key: ~/.ssh/id_rsa
        # 自定义端口映射
        script: "docker pull registry.example.com/my-project/admin-web:staging && docker stop admin-web 2>/dev/null; docker rm admin-web 2>/dev/null; docker run -d --name admin-web --restart always -p 80:80 registry.example.com/my-project/admin-web:staging"

  - name: order-service
    type: backend
    code_path: ./order-service
    deploy:
      staging:
        type: docker
        dockerfile: ./Dockerfile
        registry: registry.example.com
        image: my-project/order-service
        tag: staging
        host: deployer@staging-server.com
        key: ~/.ssh/id_rsa
        script: "docker pull registry.example.com/my-project/order-service:staging && docker stop order-service 2>/dev/null; docker rm order-service 2>/dev/null; docker run -d --name order-service --restart always -p 8080:8080 registry.example.com/my-project/order-service:staging"
```

分别执行：
```bash
speccore deploy --env staging --platform admin-web
speccore deploy --env staging --platform order-service
```

**方式 B：Docker Compose 统一部署**

将 `docker-compose.yml` 放到服务器，speccore 负责 push 镜像，服务器端执行 compose：

```yaml
# PROJECT.yaml
platforms:
  - name: fullstack
    type: infra
    code_path: ./infra/docker
    deploy:
      staging:
        type: script
        script: ./scripts/deploy-compose.sh
```

```bash
# scripts/deploy-compose.sh（在服务器上执行）
docker-compose -f /opt/deploy/docker-compose.yml pull
docker-compose -f /opt/deploy/docker-compose.yml up -d
```

---

## 各文件说明

### frontend.Dockerfile

前端多阶段构建：
- **阶段 1**（Node）：`npm ci && npm run build`
- **阶段 2**（Nginx）：托管 `dist/` 静态资源

支持通过 `BUILD_ENV` 构建参数切换环境：
```bash
docker build --build-arg BUILD_ENV=staging -t admin-web:staging .
```

### nginx.conf

- SPA 路由回退（`try_files`）
- 静态资源长期缓存
- `/api/` 代理到后端容器

### docker-compose.yml

完整编排示例，包含：
- `frontend`（Nginx）
- `backend`（Spring Boot / Node）
- `mysql`（数据库，可选）
- `redis`（缓存，可选）

通过 `.env` 文件注入敏感配置：
```bash
# .env
REGISTRY=registry.example.com
TAG=staging
PROFILE=staging
DB_PASSWORD=your-db-pass
REDIS_PASSWORD=your-redis-pass
```

### deploy-remote.sh

服务器端容器管理脚本：
- 拉取最新镜像
- 停止并删除旧容器
- 清理旧镜像（保留最近 3 个标签）
- 启动新容器
- 状态检查

---

## 快速开始

### 场景 1：前端 Docker 部署到远程服务器

```bash
# 1. 复制 Dockerfile
cp templates/deploy-docker/frontend.Dockerfile admin-web/Dockerfile
cp templates/deploy-docker/nginx.conf admin-web/nginx.conf

# 2. 配置 PROJECT.yaml
#    type: docker, host: 服务器地址, registry: 镜像仓库

# 3. 部署
speccore deploy --env staging --platform admin-web
```

### 场景 2：后端 Java Docker 部署

见 `templates/deploy-java/Dockerfile`（已包含多阶段构建）。

### 场景 3：前后端 + 数据库一次性启动

```bash
# 在服务器上
scp templates/deploy-docker/docker-compose.yml deployer@server:/opt/deploy/
scp templates/deploy-docker/.env deployer@server:/opt/deploy/

ssh deployer@server "cd /opt/deploy && docker-compose up -d"
```

---

## 数据库 / Redis 配置

### 方式 1：独立数据库（推荐生产环境）

数据库和 Redis 由运维独立维护，应用通过环境变量连接：

```yaml
# docker-compose.yml 中 backend 的 environment
- DB_HOST=prod-mysql.internal
- DB_PORT=3306
- DB_NAME=order_db
- DB_USER=order_user
- DB_PASS=${DB_PASSWORD}
- REDIS_HOST=prod-redis.internal
- REDIS_PORT=6379
```

### 方式 2：Docker Compose 内置数据库（推荐测试环境）

直接使用 `docker-compose.yml` 中的 `mysql` 和 `redis` 服务，应用通过服务名连接：

```yaml
# backend 的 environment
- DB_HOST=mysql      # Docker 网络内服务名即主机名
- REDIS_HOST=redis
```

### 方式 3：Spring Boot 多环境配置

```yaml
# src/main/resources/application-staging.yml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:mysql}:${DB_PORT:3306}/${DB_NAME:order_db}
    username: ${DB_USER:root}
    password: ${DB_PASS:}
  data:
    redis:
      host: ${REDIS_HOST:redis}
      port: ${REDIS_PORT:6379}
      password: ${REDIS_PASS:}
```

---

## 常见问题

**Q: 没有镜像仓库怎么办？**

使用 `docker save + scp + docker load`：

```bash
# 本地
docker build -t order-service:staging .
docker save order-service:staging | gzip > order-service-staging.tar.gz
scp order-service-staging.tar.gz deployer@server:/tmp/

# 远程
ssh deployer@server "gunzip -c /tmp/order-service-staging.tar.gz | docker load"
ssh deployer@server "docker stop order-service; docker rm order-service; docker run -d --name order-service -p 8080:8080 order-service:staging"
```

或改用 `script` 类型，将上述命令写入脚本由 speccore 执行。

**Q: 如何查看远程容器日志？**

```bash
ssh deployer@server "docker logs -f order-service --tail 100"
```

**Q: 如何回滚？**

```bash
# 重新部署上一个标签
speccore deploy --env staging --platform order-service --skip-build
# 然后手动在服务器上 docker run 指定旧标签
```

或保留多个标签版本：
```bash
ssh deployer@server "docker stop order-service; docker rm order-service; docker run -d --name order-service order-service:v1.2.3"
```
