# Java 后端部署指南

> 本目录提供 Java（Spring Boot）后端服务的部署模板和示例脚本。

---

## 目录结构

```
deploy-java/
├── spring-boot.service    # systemd service 文件模板
├── deploy.sh              # 服务器端部署脚本（备份 → 替换 → 重启 → 健康检查）
├── Dockerfile             # 多阶段构建 Dockerfile 示例
└── README.md              # 本文件
```

---

## 部署方式一：systemd + SSH（推荐测试环境）

### 1. 服务器端准备（只需一次）

```bash
# 创建部署目录
sudo mkdir -p /opt/services/order-service
sudo mkdir -p /var/log/order-service

# 复制 service 文件（将 spring-boot.service 中的占位符替换后复制）
# 注意：文件名必须与 PROJECT.yaml 中的 platform.name 一致
sudo cp spring-boot.service /etc/systemd/system/order-service.service

# 重载 systemd
sudo systemctl daemon-reload
sudo systemctl enable order-service
```

### 2. 替换 service 文件中的占位符

| 占位符 | 示例值 | 说明 |
|--------|--------|------|
| `{{APP_NAME}}` | `order-service` | 应用名，与 platform.name 一致 |
| `{{DEPLOY_USER}}` | `deployer` | 运行服务的系统用户 |
| `{{DEPLOY_DIR}}` | `/opt/services/order-service` | jar 文件所在目录 |
| `{{PROFILE}}` | `staging` | Spring Boot profile |
| `{{JVM_XMS}}` | `512m` | JVM 初始堆内存 |
| `{{JVM_XMX}}` | `1024m` | JVM 最大堆内存 |

### 3. PROJECT.yaml 配置

```yaml
platforms:
  - name: order-service
    type: backend
    code_path: ./order-service
    default_branch: main
    deploy:
      staging:
        type: ssh
        build_cmd: mvn clean package -DskipTests -P staging
        output_dir: target
        host: deployer@staging-server.example.com:22
        key: ~/.ssh/id_rsa
        remote_dir: /opt/services/order-service
        script: sudo systemctl restart order-service
```

### 4. 数据库 / Redis 配置切换

**方式 A：Spring Boot Profiles（推荐）**

```yaml
# src/main/resources/application-staging.yml
spring:
  datasource:
    url: jdbc:mysql://staging-db:3306/order_db
    username: ${DB_USER}
    password: ${DB_PASS}
  data:
    redis:
      host: staging-redis
      port: 6379
      password: ${REDIS_PASS}
```

**方式 B：环境变量注入（配合 systemd）**

在 `spring-boot.service` 的 `[Service]` 段增加：
```ini
Environment="DB_USER=order_user"
Environment="DB_PASS=secret"
Environment="REDIS_PASS=redis_secret"
```

在 `application.yml` 中引用：
```yaml
spring:
  datasource:
    username: ${DB_USER}
    password: ${DB_PASS}
```

### 5. 部署流程

```bash
speccore deploy --env staging --platform order-service
```

执行流程：
1. 本地执行 `mvn clean package -DskipTests -P staging`
2. SCP 上传 `target/*.jar` 到服务器 `/opt/services/order-service/`
3. SSH 执行 `sudo systemctl restart order-service`
4. systemd 自动完成：停止旧进程 → 启动新 jar → 写入日志

---

## 部署方式二：Docker（推荐生产环境）

### 1. 准备 Dockerfile

将 `Dockerfile` 复制到 Java 工程根目录（与 `pom.xml` 同级）。

### 2. PROJECT.yaml 配置

```yaml
platforms:
  - name: order-service
    type: backend
    code_path: ./order-service
    default_branch: main
    deploy:
      production:
        type: docker
        dockerfile: ./Dockerfile
        registry: registry.example.com
        image: my-project/order-service
        tag: production
```

### 3. 部署流程

```bash
speccore deploy --env production --platform order-service
```

执行流程：
1. 本地 `docker build`
2. 推送到镜像仓库 `registry.example.com/my-project/order-service:production`
3. 服务器端拉取镜像并运行（需配合额外的部署脚本或 CI/CD）

> 提示：如果服务器需要 SSH 登录后执行 `docker pull && docker run`，可将 deploy 类型改为 `script`，编写自定义脚本。

---

## 部署方式三：自定义脚本（最灵活）

如果 systemd 和 Docker 都不满足需求，使用 `script` 类型：

```yaml
deploy:
  staging:
    type: script
    build_cmd: mvn clean package -DskipTests
    script: ./scripts/deploy-custom.sh
```

---

## 数据库 / Redis 连接检查清单

| 检查项 | 说明 |
|--------|------|
| 网络连通性 | 服务器能否 ping 通数据库和 Redis 主机 |
| 防火墙 / 安全组 | 数据库端口（3306/5432）和 Redis 端口（6379）是否开放 |
| 用户名密码 | 确认 staging / production 环境的凭据正确 |
| 数据库存在性 | 目标数据库是否已创建 |
| 连接池配置 | HikariCP 的最大连接数是否超过数据库限制 |
| 时区 | JVM 时区、数据库时区、应用时区是否一致 |

---

## 常见问题

**Q: 部署后服务起不来，怎么排查？**

```bash
# 查看服务状态
sudo systemctl status order-service --no-pager

# 查看日志
sudo journalctl -u order-service -f

# 查看应用日志
tail -f /var/log/order-service/app.log
```

**Q: 如何回滚到上一个版本？**

```bash
cd /opt/services/order-service
# 找到最新备份
LATEST=$(ls -t backups/*.jar | head -1)
cp "$LATEST" order-service.jar
sudo systemctl restart order-service
```

**Q: 多个环境（staging / production）如何管理配置？**

使用 Spring Boot profiles：
- `application-staging.yml` — 测试环境
- `application-production.yml` — 生产环境
- 打包时激活 profile：`-P staging`
- 运行时激活 profile：`--spring.profiles.active=staging`
