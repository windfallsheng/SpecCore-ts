# 依赖清单

<!--
  参考格式，最终内容由 AI 根据实际需求自由组织
  本模板梳理系统所有内外部依赖，含服务、中间件、第三方库、构建工具和环境依赖
-->

---

## 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
|------|------|--------|----------|
| v1.0 | 2026-02-10 | 张三（架构师） | 初稿，基于技术方案 v1.2 梳理全部依赖 |
| v1.1 | 2026-02-15 | 李四（运维） | 补充中间件版本和 SLA 信息 |
| v1.2 | 2026-02-20 | 王五（安全） | 补充第三方库安全扫描结果 |

---

## 1. 依赖拓扑图

```
                          ┌───────────────────────────┐
                          │    订单管理系统 (本项目)      │
                          └─────────────┬─────────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        │               │               │               │               │
   ┌────▼────┐    ┌─────▼─────┐   ┌────▼────┐    ┌─────▼─────┐   ┌────▼────┐
   │用户中心  │    │支付网关(外部)│   │物流平台  │    │  消息通知  │   │  OSS   │
   │(内部服务)│    │            │   │(外部SaaS)│    │ (内部服务) │   │(内部服务)│
   └─────────┘    └───────────┘   └─────────┘    └───────────┘   └─────────┘
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        │               │               │               │               │
   ┌────▼────┐    ┌─────▼─────┐   ┌────▼────┐    ┌─────▼─────┐   ┌────▼────┐
   │  MySQL  │    │   Redis   │   │  Kafka  │    │Elasticsearch│  │  MinIO  │
   │  8.0    │    │  7.2      │   │  3.6    │    │   8.11     │  │ 自建S3  │
   └─────────┘    └───────────┘   └─────────┘    └───────────┘   └─────────┘

    图例:
    ─── 强依赖（不可用则系统中断）    - - - 弱依赖（降级可用）
    外部 = 第三方/外部供应商          内部 = 公司内部其他团队
```

---

## 2. 服务依赖

### 2.1 内部服务依赖

| 服务名称 | 接口/协议 | 版本 | 用途 | 调用频率(QPS) | 超时(ms) | 降级策略 | SLA | 负责团队 |
|---------|----------|------|------|-------------|----------|---------|-----|---------|
| 用户中心 (User Service) | gRPC / REST | v2.3.0 | 用户认证、用户信息查询 | 5000 | 200 | 返回缓存用户信息（TTL 5min） | 99.9% | 基础平台组 |
| 消息通知 (Notification Service) | Kafka 异步 | v1.5.0 | 短信/推送/邮件通知 | 200 (异步) | N/A | 降级为本地消息表 + 定时重试 | 99.5% | 增长平台组 |
| 对象存储 (OSS Gateway) | S3 API / REST | v3.1.0 | 订单凭证文件上传下载 | 100 | 5000 | 暂不支持降级，订单凭证为必填 | 99.95% | 基础平台组 |

### 2.2 外部服务依赖

| 服务名称 | 供应商 | 接口协议 | 用途 | 调用峰值 | 超时(ms) | SLA | 商业条款 | 联系人 |
|---------|--------|---------|------|---------|----------|-----|---------|--------|
| 微信支付 API | 微信支付 | HTTPS / JSON / v3 | 支付、退款、对账单 | 3000 QPS | 5000 | 99.9% | 按交易额 0.6% 手续费 | wxpay-support@example.com / 400-800-8888 |
| 快递鸟物流 | 快递鸟 (KDNiao) | HTTPS / XML | 物流轨迹查询、订阅推送 | 500 QPS | 3000 | 99.5% | 免费版 500 次/天，企业版 ¥5000/年 | kdniao-api@example.com |
| 阿里云短信 | 阿里云 | HTTPS / JSON | 短信验证码、营销通知 | 100 QPS | 2000 | 99.9% | 0.045 元/条 | aliyun-sms@example.com |

### 2.3 依赖调用示例

```java
// 用户中心 gRPC 调用示例
@Service
public class UserClient {

    private final UserServiceGrpc.UserServiceBlockingStub stub;

    @Retryable(maxAttempts = 3, backoff = @Backoff(delay = 500))
    @CircuitBreaker(name = "userService", fallbackMethod = "getUserFromCache")
    public UserDTO getUserById(Long userId) {
        GetUserRequest request = GetUserRequest.newBuilder()
                .setUserId(userId)
                .build();
        GetUserResponse response = stub.withDeadlineAfter(200, TimeUnit.MILLISECONDS)
                .getUser(request);
        return UserDTO.fromProto(response.getUser());
    }

    // 降级：从本地缓存获取用户信息
    private UserDTO getUserFromCache(Long userId, Exception e) {
        log.warn("用户中心调用失败，使用缓存降级 userId={}", userId, e);
        return cacheManager.get("user:" + userId, UserDTO.class);
    }
}
```

### 2.4 外部 API 鉴权信息

<!-- ⚠️ 实际 Key/Secret 需通过 KMS 或环境变量注入，此处仅说明鉴权方式 -->

| 服务 | 鉴权方式 | 密钥管理 | 轮换周期 |
|------|---------|---------|---------|
| 微信支付 | API v3 证书 + RSA 签名 | KMS + Vault | 每 6 个月轮换 |
| 快递鸟 | API Key + MD5 签名 | KMS | 每 1 年轮换 |
| 阿里云短信 | AK/SK | KMS | 每 3 个月轮换 |

---

## 3. 中间件依赖

### 3.1 中间件清单

| 中间件 | 版本 | 部署模式 | 用途 | 资源规格 | 高可用方案 | 负责人 |
|--------|------|---------|------|---------|-----------|--------|
| MySQL | 8.0.33 | 主从复制 (1 主 2 从) | 订单、支付核心数据存储 | 16C64G × 3 节点 | MHA 自动 Failover | DBA |
| Redis | 7.2.4 | Cluster (6 节点) | 缓存、分布式锁、Session | 8C16G × 6 节点 | Cluster 自带 Failover | 运维 |
| Apache Kafka | 3.6.1 | Cluster (3 Broker, 3 ZK) | 订单事件流、异步解耦 | 8C16G × 3 Broker | ISR 机制，min.insync.replicas=2 | 运维 |
| Elasticsearch | 8.11.0 | Cluster (3 Data + 2 Master) | 订单搜索、操作日志 | 16C32G × 3 Data | 自动分片重分配 | 运维 |
| MinIO | RELEASE.2024 | 分布式 (4 节点) | 订单凭证/物流单据存储 | 8C16G × 4 节点 + 2TB SSD | Erasure Code EC:2 | 运维 |

### 3.2 中间件客户端连接配置

```yaml
# Spring Boot 中间件连接配置示例 (application-prod.yml)
spring:
  datasource:
    url: jdbc:mysql://mysql-master:3306/order_db?useSSL=true&serverTimezone=Asia/Shanghai
    username: ${DB_USERNAME}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 50
      minimum-idle: 10
      connection-timeout: 3000
      idle-timeout: 600000
      max-lifetime: 1800000

  redis:
    cluster:
      nodes:
        - redis-node1:6379
        - redis-node2:6379
        - redis-node3:6379
        - redis-node4:6379
        - redis-node5:6379
        - redis-node6:6379
    password: ${REDIS_PASSWORD}
    lettuce:
      pool:
        max-active: 100
        max-idle: 50
        min-idle: 10

  kafka:
    bootstrap-servers: kafka1:9092,kafka2:9092,kafka3:9092
    producer:
      acks: all
      retries: 3
      compression-type: snappy
    consumer:
      group-id: order-service-group
      enable-auto-commit: false
      max-poll-records: 500
```

---

## 4. 第三方库依赖

### 4.1 Java (Maven) 核心依赖

<!-- 仅列出直接依赖的一级核心库，完整列表见 pom.xml / build.gradle -->

| GroupId | ArtifactId | 版本 | 用途 | License | 已知漏洞 | 替代方案 |
|---------|-----------|------|------|---------|---------|---------|
| org.springframework.boot | spring-boot-starter-web | 3.2.5 | Web 框架 | Apache 2.0 | 无 | - |
| org.springframework.boot | spring-boot-starter-data-jpa | 3.2.5 | ORM 框架 | Apache 2.0 | 无 | MyBatis |
| com.baomidou | mybatis-plus-boot-starter | 3.5.5 | MyBatis 增强 | Apache 2.0 | 无 | JPA |
| io.github.resilience4j | resilience4j-spring-boot3 | 2.2.0 | 熔断/限流/重试 | Apache 2.0 | 无 | Sentinel |
| org.redisson | redisson-spring-boot-starter | 3.27.2 | Redis 分布式锁 | Apache 2.0 | 无 | Jedis + RedLock |
| com.github.wechatpay-apiv3 | wechatpay-java | 0.2.12 | 微信支付 SDK | MIT | 无 | - |
| org.projectlombok | lombok | 1.18.30 | 代码简化 | MIT | 无 | 手动编写 |
| io.micrometer | micrometer-registry-prometheus | 1.12.5 | Prometheus Metrics | Apache 2.0 | 无 | OpenTelemetry |

### 4.2 Node.js (npm) 核心依赖

| Package | 版本 | 用途 | License | 已知漏洞 |
|---------|------|------|---------|---------|
| express | 4.18.2 | Web 框架 | MIT | 无 |
| ioredis | 5.3.2 | Redis 客户端 | MIT | 无 |
| kafkajs | 2.2.4 | Kafka 客户端 | MIT | 无 |
| axios | 1.6.8 | HTTP 客户端 | MIT | 无 |
| winston | 3.12.0 | 日志库 | MIT | 无 |

### 4.3 依赖安全扫描

```bash
# Maven 依赖安全扫描 (OWASP Dependency-Check)
mvn org.owasp:dependency-check-maven:check \
  -DfailBuildOnCVSS=7 \
  -Dformat=HTML \
  -DoutputDirectory=./security-reports

# npm 依赖安全扫描
npm audit --audit-level=high
```

| 扫描工具 | 执行频率 | 阻断条件 |
|---------|---------|---------|
| OWASP Dependency-Check (Maven) | 每次 CI 构建 | CVSS ≥ 7.0 |
| npm audit | 每次 CI 构建 | High 及以上 |
| Trivy (Docker Image) | 每次镜像构建 | Critical 漏洞 |
| Snyk | 每周全量扫描 | 高危漏洞自动创建 Jira 工单 |

---

## 5. 构建与部署工具

| 工具 | 版本 | 用途 | 备注 |
|------|------|------|------|
| JDK | OpenJDK 21 | Java 编译运行 | LTS 版本 |
| Node.js | 20.11 LTS | 前端 / BFF 层运行时 | LTS 版本 |
| Go | 1.22 | Pay Service 编译 | - |
| Maven | 3.9.6 | Java 项目构建 | - |
| Docker | 24.0 + BuildKit | 容器镜像构建 | 多阶段构建 |
| Docker Compose | v2.24 | 本地开发环境 | 一键启动全部中间件 |
| Kubernetes | 1.29.x | 容器编排 | 生产环境 |
| Helm | 3.14 | K8s 应用打包 | Chart 版本管理 |
| ArgoCD | 2.10 | GitOps 部署 | 自动同步 Git 仓库中的 K8s 清单 |
| GitHub Actions | - | CI Pipeline | 构建、测试、安全扫描 |
| Jaeger | 1.55 | 分布式链路追踪 | OpenTelemetry 协议 |
| Prometheus | 2.50 | 监控指标采集 | 联合 Grafana 使用 |
| Grafana | 10.4 | 监控面板/告警 | Dashboard 配置见监控方案 |

---

## 6. 环境依赖

### 6.1 资源配置

| 环境 | 用途 | K8s Namespace | 节点规格 | 最小节点数 | 最大节点数 |
|------|------|-------------|---------|----------|----------|
| DEV | 开发联调 | dev | 4C8G | 3 | 5 |
| TEST | 功能测试 | test | 4C8G | 3 | 5 |
| STAGING | 预发布 | staging | 8C16G | 5 | 10 |
| PROD | 生产环境 | production | 16C32G | 10 | 30 |

### 6.2 网络与域名

| 环境 | 域名 | 证书 | 网络策略 |
|------|------|------|---------|
| DEV | dev-api.example.com | 自签名 | 仅内网访问 |
| TEST | test-api.example.com | 自签名 | 仅内网访问 |
| STAGING | staging-api.example.com | Let's Encrypt | 白名单 IP 可访问 |
| PROD | api.example.com | 商业 CA | 公网可访问，WAF 防护 |

### 6.3 外部依赖可用性检查脚本

```bash
#!/bin/bash
# 依赖可用性健康检查脚本 (部署前执行)
set -e

echo "=== 检查 MySQL 连接 ==="
mysqladmin ping -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASS

echo "=== 检查 Redis 连接 ==="
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASS PING

echo "=== 检查 Kafka 连接 ==="
kafka-broker-api-versions --bootstrap-server $KAFKA_BROKERS

echo "=== 检查 Elasticsearch 连接 ==="
curl -s -o /dev/null -w "%{http_code}" "$ES_HOST:9200/_cluster/health"

echo "=== 检查 微信支付 API ==="
curl -s -o /dev/null -w "%{http_code}" https://api.mch.weixin.qq.com/v3/certificates

echo "=== 所有依赖检查通过 ==="
```

### 6.4 依赖降级优先级

<!-- 当部分依赖不可用时，按以下优先级执行降级 -->

| 优先级 | 依赖 | 降级策略 | 用户感知 |
|--------|------|---------|---------|
| 1 | 物流轨迹查询 | 显示"物流信息更新中"，定时重试 | 轻微 |
| 2 | 消息通知 | 入本地消息表，延迟推送 | 无感知 |
| 3 | ES 搜索 | 降级为 MySQL LIKE 查询 | 搜索变慢 |
| 4 | Redis | 读直连 DB，写禁用缓存 | 延迟增加 |
| N/A | MySQL | 不可降级，系统中断 | 中断 |

---

## 7. 依赖变更管理

| 变更类型 | 审批流程 | 通知范围 | 回滚方案 |
|---------|---------|---------|---------|
| 升级中间件版本号 | Tech Lead 审批 + DBA 确认 | 全团队 | 版本回退脚本 |
| 新增第三方库 | Tech Lead 审批 + 安全扫描通过 | 架构组 | 移除依赖 |
| 新增外部服务依赖 | 架构评审 + 安全评审 | 相关团队 | 关闭接口调用 |
| 依赖 SLA 变更 | PM + Tech Lead 评估 | 产品 + 商务 | 合同条款协商 |
