# 技术方案

<!--
  参考格式，最终内容由 AI 根据实际需求自由组织
  本模板覆盖技术方案设计的关键维度：架构、模块、数据库、接口、缓存、安全、部署
-->

---

## 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
|------|------|--------|----------|
| v1.0 | 2026-01-20 | 张三 | 初稿，基于需求分析 v1.2 编写技术方案 |
| v1.1 | 2026-01-25 | 李四 | 补充缓存策略和数据库分库分表方案 |
| v1.2 | 2026-02-05 | 王五 | 更新部署架构，新增 K8s 集群配置 |

---

## 1. 架构概览

### 1.1 系统架构图

```
                          ┌──────────────┐
                          │    CDN/Nginx  │ (静态资源 + 反向代理)
                          └──────┬───────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     ┌────────▼────────┐ ┌──────▼──────┐ ┌────────▼────────┐
     │  API Gateway    │ │  BFF Layer  │ │   Web Server    │
     │  (Kong/APISIX)  │ │  (Node.js)  │ │   (Nginx)       │
     └────────┬────────┘ └──────┬──────┘ └────────┬────────┘
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     ┌────────▼────────┐ ┌──────▼──────┐ ┌────────▼────────┐
     │ Order Service   │ │Pay Service  │ │Logistics Service│
     │ (Spring Boot)   │ │(Go)         │ │(Node.js)        │
     └────────┬────────┘ └──────┬──────┘ └────────┬────────┘
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
 ┌──────▼──────┐          ┌──────▼──────┐          ┌──────▼──────┐
 │   MySQL     │          │   Redis     │          │Elasticsearch│
 │  (主从+分库) │          │  (Cluster)  │          │  (日志&搜索) │
 └─────────────┘          └─────────────┘          └─────────────┘
```

### 1.2 架构决策记录 (ADR)

| 编号 | 决策 | 理由 | 替代方案 | 影响 |
|------|------|------|---------|------|
| ADR-001 | Order Service 使用 Spring Boot 3.x | 团队主力技术栈，生态成熟 | Go/Node.js | 开发效率高，运维成本可控 |
| ADR-002 | Pay Service 使用 Go | 高并发场景性能优异，内存占用低 | Rust/Java | 支付链路 P99 延迟预期 < 100ms |
| ADR-003 | API Gateway 选型 APISIX | 云原生、高性能、插件丰富 | Kong/Nginx+Lua | 运维复杂度略增，扩展性大幅提升 |
| ADR-004 | 数据库使用 MySQL 8.0 + 分库分表 | 团队 DBA 经验丰富，工具链成熟 | PostgreSQL/TiDB | 需提前规划分片键 |

---

## 2. 技术选型

### 2.1 技术栈总览

| 层次 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| 后端框架 | Spring Boot | 3.2.x | Order Service 主力框架 |
| 后端框架 | Go-Zero | 1.6.x | Pay Service 微服务框架 |
| 后端框架 | Express.js | 4.18.x | Logistics Service |
| 数据库 | MySQL | 8.0.33 | InnoDB 引擎，主从复制 |
| 缓存 | Redis | 7.2.x | Cluster 模式，6 节点 |
| 搜索引擎 | Elasticsearch | 8.11.x | 订单全文搜索 + 日志存储 |
| 消息队列 | Apache Kafka | 3.6.x | 订单状态变更事件流 |
| API Gateway | Apache APISIX | 3.8.x | 统一网关，含限流/鉴权/路由 |
| 对象存储 | MinIO (自建) | RELEASE.2024 | 订单凭证、物流单据存储 |
| 容器编排 | Kubernetes | 1.29.x | 生产环境容器调度 |
| 服务网格 | Istio | 1.21.x | 服务间流量管理与可观测性 |
| CI/CD | GitHub Actions + ArgoCD | - | GitOps 工作流 |

---

## 3. 模块设计

### 3.1 Order Service 核心类图

```
┌─────────────────────────────────────────────┐
│              OrderController                 │
│  + createOrder(req): ResponseEntity         │
│  + getOrder(id): ResponseEntity             │
│  + cancelOrder(id): ResponseEntity          │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              OrderService                    │
│  - orderRepo: OrderRepository               │
│  - inventoryClient: InventoryClient         │
│  - couponClient: CouponClient               │
│  + create(orderReq): Order                  │
│  + findById(id): Order                      │
│  + cancel(id, reason): void                 │
│  - validateStock(items): boolean            │
│  - calculateAmount(items): BigDecimal       │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│              OrderRepository                 │
│  + save(order): Order                       │
│  + findById(id): Optional<Order>            │
│  + findByCustomerId(cid, page): Page<Order> │
└─────────────────────────────────────────────┘
```

### 3.2 创建订单时序图

```
客户端          API Gateway      Order Service     Inventory Service    Payment Service
  │                 │                  │                   │                   │
  │  POST /orders   │                  │                   │                   │
  │────────────────>│                  │                   │                   │
  │                 │  鉴权 + 限流     │                   │                   │
  │                 │─────────────────>│                   │                   │
  │                 │                  │                   │                   │
  │                 │                  │ validateStock()   │                   │
  │                 │                  │──────────────────>│                   │
  │                 │                  │<──────────────────│                   │
  │                 │                  │   stock OK        │                   │
  │                 │                  │                   │                   │
  │                 │                  │ save(order)       │                   │
  │                 │                  │──────┐            │                   │
  │                 │                  │<─────┘            │                   │
  │                 │                  │                   │                   │
  │                 │                  │ publish(OrderCreatedEvent)           │
  │                 │                  │──────────────────────────────────────>│
  │                 │                  │                   │          (Kafka)  │
  │                 │  201 Created     │                   │                   │
  │<────────────────│<─────────────────│                   │                   │
  │  {orderId, ...} │                  │                   │                   │
```

---

## 4. 数据库设计

### 4.1 ER 图

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ t_customer   │       │   t_order    │       │   t_payment  │
├──────────────┤       ├──────────────┤       ├──────────────┤
│ id       PK  │──┐    │ id       PK  │──┐    │ id       PK  │
│ name         │  │    │ order_no UK  │  │    │ pay_no   UK  │
│ phone        │  │    │ customer_idFK│──┘    │ order_id  FK │──┐
│ email        │  │    │ status       │       │ amount       │  │
│ created_at   │  │    │ total_amount │       │ channel      │  │
│ updated_at   │  │    │ discount_amt │       │ status       │  │
└──────────────┘  │    │ actual_amount│       │ paid_at      │  │
                  │    │ expire_time  │       │ created_at   │  │
                  │    │ cancel_reason│       └──────────────┘  │
                  │    │ created_at   │                         │
                  │    │ updated_at   │                         │
                  │    └──────────────┘                         │
                  │           │                                 │
                  │           │ 1:N                             │
                  │           v                                 │
                  │    ┌──────────────┐                         │
                  │    │ t_order_item │                         │
                  │    ├──────────────┤                         │
                  │    │ id       PK  │                         │
                  └────│ order_id FK  │─────────────────────────┘
                       │ sku_id       │
                       │ sku_name     │
                       │ quantity     │
                       │ unit_price   │
                       └──────────────┘
```

### 4.2 核心表 DDL

```sql
-- 订单主表
CREATE TABLE `t_order` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `order_no` VARCHAR(32) NOT NULL COMMENT '订单号，全局唯一（雪花算法生成）',
  `customer_id` BIGINT UNSIGNED NOT NULL COMMENT '用户 ID',
  `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING_PAYMENT' COMMENT '订单状态',
  `total_amount` DECIMAL(12,2) NOT NULL COMMENT '商品总金额',
  `discount_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '优惠金额',
  `actual_amount` DECIMAL(12,2) NOT NULL COMMENT '实付金额',
  `shipping_address` JSON NOT NULL COMMENT '收货地址 JSON',
  `expire_time` DATETIME NOT NULL COMMENT '支付过期时间',
  `cancel_reason` VARCHAR(255) DEFAULT NULL COMMENT '取消原因',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_customer_status` (`customer_id`, `status`),
  KEY `idx_status_created` (`status`, `created_at`),
  KEY `idx_expire_time` (`expire_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单主表';

-- 支付记录表
CREATE TABLE `t_payment` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `pay_no` VARCHAR(32) NOT NULL COMMENT '支付流水号',
  `order_id` BIGINT UNSIGNED NOT NULL COMMENT '关联订单 ID',
  `amount` DECIMAL(12,2) NOT NULL COMMENT '支付金额',
  `channel` VARCHAR(16) NOT NULL COMMENT '支付渠道: WEPAY/ALIPAY/BALANCE',
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING' COMMENT '支付状态: PENDING/SUCCESS/FAIL/REFUNDING/REFUNDED',
  `third_party_tx_id` VARCHAR(64) DEFAULT NULL COMMENT '第三方支付流水号',
  `paid_at` DATETIME DEFAULT NULL COMMENT '支付完成时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pay_no` (`pay_no`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付记录表';
```

### 4.3 分库分表策略

| 拆分维度 | 策略 | 说明 |
|----------|------|------|
| 分片键 | customer_id | 按用户 ID 取模路由 |
| 分库数 | 4 库 | 每库承载约 25% 流量 |
| 分表数 | 每库 16 表 | t_order_00 ~ t_order_15 |
| 路由算法 | `customer_id % 4` 定位库，`customer_id % 16` 定位表 |
| 全局 ID | 雪花算法 (Snowflake) | 保证分布式环境 ID 唯一且趋势递增 |

---

## 5. 接口设计

### 5.1 接口规范

所有接口遵循 RESTful 设计规范，使用以下约定：

- **Base URL**: `https://api.example.com/v1`
- **认证**: Header `Authorization: Bearer <JWT>`
- **幂等**: Header `Idempotency-Key: <UUID>`
- **分页**: Query `?page=1&size=20`
- **通用响应格式**:

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "requestId": "req_20260120_001"
}
```

### 5.2 支付回调接口

```json
// POST /api/v1/payments/callback
// 请求头: X-Signature: <RSA_SHA256_SIGNATURE>

{
  "orderNo": "ORD-20260120-001",
  "payNo": "PAY-20260120-001",
  "channel": "WEPAY",
  "amount": 178.00,
  "status": "SUCCESS",
  "thirdPartyTxId": "WX202601201234567890",
  "paidAt": "2026-01-20T12:05:30+08:00"
}

// 响应
{
  "code": 0,
  "message": "success",
  "data": {
    "acknowledged": true
  }
}
```

---

## 6. 缓存策略

### 6.1 缓存架构

| 缓存层 | 技术 | 数据类型 | TTL | 淘汰策略 |
|--------|------|---------|-----|---------|
| 本地缓存 | Caffeine | 热点配置数据 | 5 min | LRU，最大 10000 条 |
| 分布式缓存 | Redis Cluster | 用户 Session、订单详情 | 30 min | volatile-lru |
| CDN 缓存 | Nginx Proxy Cache | 静态资源 | 24 h | 按文件 hash |

### 6.2 缓存更新策略

```
读流程:                           写流程:
┌──────────┐                    ┌──────────┐
│ 请求数据  │                    │  写请求   │
└────┬─────┘                    └────┬─────┘
     v                               v
┌──────────┐                    ┌──────────┐
│ 查 Redis │──命中──> 返回       │ 更新 DB  │
└────┬─────┘                    └────┬─────┘
     │未命中                         v
     v                          ┌──────────┐
┌──────────┐                    │删除 Redis│ (Cache-Aside)
│ 查 MySQL │                    │ 对应 Key  │
└────┬─────┘                    └──────────┘
     v
┌──────────┐
│写入 Redis│
└────┬─────┘
     v
   返回
```

### 6.3 缓存穿透/击穿/雪崩方案

| 问题 | 方案 | 实现 |
|------|------|------|
| 缓存穿透（查不存在的数据） | 布隆过滤器 + 空值缓存 | RedisBloom 模块，空值缓存 5 分钟 |
| 缓存击穿（热点 Key 过期） | 互斥锁 + 逻辑过期 | Redisson 分布式锁 + 异步刷新 |
| 缓存雪崩（大量 Key 同时过期） | TTL 加随机偏移 | TTL = base + random(0, 600) 秒 |

---

## 7. 安全方案

### 7.1 安全架构

| 安全层 | 措施 | 工具/实现 |
|--------|------|----------|
| 传输安全 | HTTPS + TLS 1.3，HSTS 头部 | Nginx + Let's Encrypt |
| 认证 | JWT (RS256) + Refresh Token 机制 | 自研 Auth Service |
| 鉴权 | RBAC 权限模型，接口级权限校验 | APISIX + Casbin |
| 数据安全 | 手机号/身份证 AES-256 加密存储 | 密钥托管于 KMS |
| 防注入 | SQL 参数化查询 + XSS 输出编码 | ORM 自动防注入，DOMPurify |
| 防重放 | 请求时间戳 + Nonce 校验 | API Gateway 插件 |
| 日志审计 | 关键操作全量记录 | Kafka → ES → 审计报表 |

### 7.2 API 安全规则

```yaml
# APISIX 安全配置示例
plugins:
  limit-req:
    rate: 100             # 单用户 100 req/min
    burst: 20
    key: http_x_user_id
  jwt-auth:
    secret: ${JWT_SECRET}
    algorithm: RS256
  cors:
    allow_origins: "https://*.example.com"
    allow_methods: "GET,POST,PUT,DELETE"
  ip-restriction:
    whitelist:
      - 10.0.0.0/8       # 内网白名单
```

---

## 8. 部署架构

### 8.1 环境规划

| 环境 | 用途 | 资源配置 | 节点数 |
|------|------|---------|--------|
| DEV | 开发联调 | 2C4G | 1 |
| TEST | 功能测试 | 4C8G | 2 |
| STAGING | 预发布验证 | 8C16G | 3 |
| PROD | 生产环境 | 16C32G | 6 (多 AZ) |

### 8.2 Kubernetes 部署配置

```yaml
# Order Service Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
spec:
  replicas: 6
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
      - name: order-service
        image: registry.example.com/order-service:v1.2.0
        resources:
          requests:
            cpu: "2"
            memory: "4Gi"
          limits:
            cpu: "4"
            memory: "8Gi"
        env:
        - name: SPRING_PROFILES_ACTIVE
          value: "prod"
        - name: DB_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        livenessProbe:
          httpGet:
            path: /actuator/health/liveness
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /actuator/health/readiness
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 6
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 8.3 灰度发布策略

```
100% 流量
    │
    ├── 95% → Stable Version (v1.2.0)
    │
    └── 5%  → Canary Version (v1.3.0)
              │
              └── 监控 30 分钟无异常 → 逐步提升至 50% → 100%
```

---

## 9. 技术风险与降级

| 风险场景 | 降级方案 | 恢复条件 |
|---------|---------|---------|
| MySQL 主库故障 | 自动切换至从库，只读模式 | DBA 修复后可读写 |
| Redis Cluster 故障 | 直接查 MySQL，关闭缓存层 | Redis 恢复后重建缓存 |
| 支付网关超时 | 异步重试 3 次，每次间隔 5s | 支付网关恢复或用户重新发起 |
| Kafka 故障 | 事件降级为本地消息表 + 定时轮询 | Kafka 恢复后消费积压 |
