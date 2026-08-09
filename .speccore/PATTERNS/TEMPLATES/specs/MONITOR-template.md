# 监控方案

<!--
  参考格式，最终内容由 AI 根据实际需求自由组织
  本模板覆盖业务指标、技术指标、日志规范、链路追踪、告警规则、Dashboard 配置
  监控体系基于 Google SRE 四大黄金信号：延迟、流量、错误、饱和度
-->

---

## 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
|------|------|--------|----------|
| v1.0 | 2026-02-15 | 张三（SRE） | 初稿，基于技术方案 v1.2 编写监控方案 |
| v1.1 | 2026-02-20 | 李四（后端） | 补充核心接口 PromQL 示例和业务指标 |
| v1.2 | 2026-02-25 | 王五（运营） | 补充告警降噪策略和值班机制 |

---

## 1. 监控架构

```
                          ┌─────────────────────────┐
                          │       Grafana 10.4       │
                          │  (Dashboard / Alerting)  │
                          └────────────┬────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
     ┌────────▼────────┐     ┌────────▼────────┐     ┌────────▼────────┐
     │   Prometheus    │     │      Jaeger     │     │ Elasticsearch   │
     │  (Metrics 指标)  │     │  (Trace 链路)    │     │  (Log 日志)     │
     └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
              │                        │                        │
              │  Micrometer            │  OpenTelemetry         │  Filebeat / Logback
              │                        │                        │
     ┌────────▼────────────────────────▼────────────────────────▼────────┐
     │                         应用层 (Order / Pay / Logistics Service)    │
     │                                                                     │
     │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
     │  │ Order Service│  │ Pay Service  │  │Logistics Svc │              │
     │  │ (Java)       │  │ (Go)         │  │ (Node.js)    │              │
     │  └──────────────┘  └──────────────┘  └──────────────┘              │
     └─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 业务指标

### 2.1 核心业务指标定义

| 指标名称 | 英文名 | 计算方式 | 统计粒度 | PromQL 示例 |
|---------|--------|---------|---------|------------|
| 订单创建量 | order_created_total | Counter，每次成功创建 +1 | 1 min / 5 min / 1 h | `rate(order_created_total[5m])` |
| 支付成功率 | payment_success_rate | 支付成功数 / 支付发起数 × 100% | 5 min | `sum(rate(payment_success_total[5m])) / sum(rate(payment_initiate_total[5m])) * 100` |
| 支付平均金额 | payment_avg_amount | 支付总额 / 支付成功笔数 | 1 h | `sum(rate(payment_amount_sum[1h])) / sum(rate(payment_success_total[1h]))` |
| 退款率 | refund_rate | 退款笔数 / 支付成功笔数 × 100% | 1 h | `sum(rate(refund_total[1h])) / sum(rate(payment_success_total[1h])) * 100` |
| 订单取消率 | order_cancel_rate | 取消订单数 / 订单创建数 × 100% | 1 h | `sum(rate(order_cancelled_total[1h])) / sum(rate(order_created_total[1h])) * 100` |
| 用户支付转化漏斗 | payment_funnel | 下单→支付→完成 各阶段转化率 | 1 h | 使用 Grafana Funnel Panel |
| ARPU (每用户平均收入) | arpu | 支付总额 / 支付用户数 | 1 d | `sum(increase(payment_amount_sum[1d])) / count(increase(payment_user_unique[1d]))` |

### 2.2 业务指标告警阈值

| 指标 | 告警级别 | 告警条件 | 持续时间 | 通知渠道 | 处理人 |
|------|---------|---------|---------|---------|--------|
| 支付成功率 | P0 紧急 | < 95% | 5 分钟 | 电话 + 钉钉 + 企微 | Oncall + 支付团队 |
| 支付成功率 | P1 警告 | < 98% | 10 分钟 | 钉钉 + 企微 | 支付团队 |
| 订单创建量 | P1 警告 | 环比下降 > 30% | 15 分钟 | 钉钉 | 后端团队 |
| 退款率 | P2 提醒 | > 5% | 30 分钟 | 钉钉 | 产品 + 运营 |
| 退款率 | P1 警告 | > 10% | 15 分钟 | 钉钉 + 电话 | Oncall |
| 订单取消率 | P2 提醒 | > 15% | 30 分钟 | 钉钉 | 后端团队 |

---

## 3. 技术指标

### 3.1 四大黄金信号 (Google SRE)

| 信号 | 指标 | PromQL 示例 | 告警条件 |
|------|------|------------|---------|
| **延迟 (Latency)** | HTTP 请求 P99 延迟 | `histogram_quantile(0.99, rate(http_server_requests_seconds_bucket{uri=~"/v1/orders.*"}[5m]))` | P99 > 500ms |
| **流量 (Traffic)** | HTTP 请求 QPS | `rate(http_server_requests_seconds_count[5m])` | 环比波动 > 50% |
| **错误 (Errors)** | HTTP 5xx 比率 | `rate(http_server_requests_seconds_count{status=~"5.."}[5m]) / rate(http_server_requests_seconds_count[5m])` | > 1% |
| **饱和度 (Saturation)** | CPU / Memory / Thread Pool | `jvm_threads_live_threads / jvm_threads_peak_threads` | > 80% |

### 3.2 JVM 指标 (Java 服务专用)

| 指标 | PromQL | 告警阈值 |
|------|--------|---------|
| JVM 堆内存使用率 | `jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"} * 100` | > 85% → P1, > 95% → P0 |
| GC 暂停时间 | `rate(jvm_gc_pause_seconds_sum[5m])` | P99 > 100ms → P1 |
| 线程池活跃度 | `executor_active_threads / executor_pool_size` | > 80% → P1 |
| 数据库连接池使用率 | `hikaricp_connections_active / hikaricp_connections_max` | > 80% → P1 |

### 3.3 Go 服务指标 (Pay Service)

| 指标 | PromQL | 告警阈值 |
|------|--------|---------|
| Goroutine 数量 | `go_goroutines` | > 10000 → P1 |
| GC 暂停时间 | `go_gc_duration_seconds{quantile="0.99"}` | > 10ms → P1 |
| 内存分配速率 | `rate(go_memstats_alloc_bytes_total[5m])` | 异常飙升 → P2 |

### 3.4 中间件指标

| 中间件 | 关键指标 | PromQL | 告警 |
|--------|---------|--------|------|
| MySQL | 连接数使用率 | `mysql_global_status_threads_connected / mysql_global_variables_max_connections * 100` | > 80% → P1 |
| MySQL | 慢查询数 | `rate(mysql_global_status_slow_queries[5m])` | > 10/min → P2 |
| MySQL | 主从延迟 | `mysql_slave_status_seconds_behind_master` | > 5s → P1 |
| Redis | 内存使用率 | `redis_memory_used_bytes / redis_memory_max_bytes * 100` | > 80% → P1 |
| Redis | 连接数 | `redis_connected_clients` | > 5000 → P2 |
| Kafka | Consumer Lag | `kafka_consumer_group_lag{topic="order-events"}` | > 10000 → P2, > 50000 → P1 |
| ES | 集群健康度 | `elasticsearch_cluster_health_status{color="red"}` | Red → P0 |

---

## 4. 日志规范

### 4.1 日志级别定义

| 级别 | 适用场景 | 示例 | 保留策略 |
|------|---------|------|---------|
| ERROR | 需人工介入的异常（支付失败、DB 不可用） | `log.error("支付回调处理失败 orderNo={} ", orderNo, e);` | 90 天 |
| WARN | 可自动恢复的异常（重试成功、降级触发） | `log.warn("Redis 连接失败，降级查询 DB userId={}", userId);` | 30 天 |
| INFO | 关键业务节点（订单创建、支付成功、退款完成） | `log.info("订单创建成功 orderNo={} amount={}", orderNo, amount);` | 30 天 |
| DEBUG | 开发调试信息（方法入参出参） | `log.debug("查询订单参数: {}", queryDTO);` | 7 天 |

### 4.2 日志格式规范

```json
// 生产环境日志格式 (JSON, 便于 ES 解析)
{
  "timestamp": "2026-02-15T10:30:00.123+08:00",
  "level": "INFO",
  "service": "order-service",
  "traceId": "a1b2c3d4e5f67890",         // 全链路追踪 ID
  "spanId": "1234567890abcdef",           // Span ID
  "userId": "cust_001",
  "orderNo": "ORD-20260215-001",
  "message": "订单创建成功",
  "extra": {
    "amount": 178.00,
    "itemCount": 2,
    "channel": "MINI_PROGRAM"
  }
}
```

### 4.3 Logback 配置 (Spring Boot)

```xml
<!-- logback-spring.xml 核心配置 -->
<configuration>
    <appender name="CONSOLE_JSON" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <includeMdcKeyName>traceId</includeMdcKeyName>
            <includeMdcKeyName>spanId</includeMdcKeyName>
            <includeMdcKeyName>userId</includeMdcKeyName>
            <includeMdcKeyName>orderNo</includeMdcKeyName>
            <customFields>{"service":"order-service","env":"${SPRING_PROFILES_ACTIVE}"}</customFields>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE_JSON" />
    </root>

    <!-- 关键包 DEBUG 级别 -->
    <logger name="com.example.order.service" level="DEBUG" />
    <!-- 框架日志 WARN 级别，减少噪音 -->
    <logger name="org.springframework" level="WARN" />
    <logger name="com.zaxxer.hikari" level="WARN" />
</configuration>
```

### 4.4 脱敏规则

<!-- 防止敏感信息泄露到日志中 -->

| 数据类型 | 脱敏规则 | 示例 |
|---------|---------|------|
| 手机号 | 保留前 3 后 4，中间 4 位用 **** 替代 | 138****8000 |
| 身份证号 | 保留前 3 后 4，中间用 **** 替代 | 440****1234 |
| 支付金额 | 保留完整的业务数据（非敏感） | 178.00 |
| 银行卡号 | 保留后 4 位，其余用 **** 替代 | **** **** **** 8888 |
| JWT Token | 不记录，仅记录 userId | - |
| 密码 | 禁止记录 | - |

---

## 5. 链路追踪

### 5.1 追踪接入

```yaml
# OpenTelemetry 配置 (application.yml)
otel:
  service:
    name: order-service
  exporter:
    otlp:
      endpoint: http://jaeger-collector:4317
  traces:
    sampler:
      type: parentbased_traceidratio
      param: 0.1                     # 10% 采样率 (生产环境)
    # 关键接口 100% 采样通过代码注解控制
```

```java
// 关键接口 100% 采样 + 自定义 Span
@RestController
@RequestMapping("/v1/orders")
public class OrderController {

    @PostMapping
    @WithSpan(kind = SpanKind.SERVER)              // 100% 采样核心接口
    public ResponseEntity<OrderVO> createOrder(@RequestBody CreateOrderRequest req) {
        Span span = Span.current();
        span.setAttribute("order.customerId", req.getCustomerId());
        span.setAttribute("order.amount", req.getTotalAmount().toString());

        // 自定义子 Span：库存校验
        return Span.from(span.getSpanContext())
                .setName("inventory.check")
                .wrap(() -> {
                    inventoryService.checkStock(req.getItems());
                    return ResponseEntity.ok(orderService.create(req));
                });
    }
}
```

### 5.2 关键链路追踪场景

| 链路场景 | 涉及服务 | 预期延迟 | 关键 Span |
|---------|---------|---------|----------|
| 用户下单 | APISIX → Order → Inventory → Kafka → Payment | P99 < 500ms | order.create, inventory.check, payment.initiate |
| 支付回调 | Payment Gateway → APISIX → Payment | P99 < 200ms | payment.callback, order.status_update |
| 退款申请 | APISIX → Order → Payment → Notification | P99 < 1s | refund.apply, refund.process, refund.notify |

---

## 6. 告警规则

### 6.1 Prometheus 告警规则定义

```yaml
# prometheus-alerts.yml
groups:
  - name: order-service-critical
    rules:
      # ===== P0 告警 =====
      - alert: OrderServiceDown
        expr: up{job="order-service"} == 0
        for: 1m
        labels:
          severity: critical
          level: P0
        annotations:
          summary: "订单服务宕机"
          description: "订单服务实例 {{ $labels.instance }} 已停止响应超过 1 分钟"

      - alert: PaymentSuccessRateDrop
        expr: |
          sum(rate(payment_success_total[5m])) / sum(rate(payment_initiate_total[5m])) < 0.95
        for: 5m
        labels:
          severity: critical
          level: P0
        annotations:
          summary: "支付成功率低于 95%"
          description: "当前支付成功率: {{ $value | humanizePercentage }}"

      # ===== P1 告警 =====
      - alert: HighErrorRate
        expr: |
          rate(http_server_requests_seconds_count{status=~"5.."}[5m])
          / rate(http_server_requests_seconds_count[5m]) > 0.01
        for: 5m
        labels:
          severity: warning
          level: P1
        annotations:
          summary: "HTTP 5xx 错误率超过 1%"
          description: "接口 {{ $labels.uri }} 错误率 {{ $value | humanizePercentage }}"

      - alert: HighP99Latency
        expr: |
          histogram_quantile(0.99,
            rate(http_server_requests_seconds_bucket{uri=~"/v1/orders.*"}[5m])
          ) > 0.5
        for: 5m
        labels:
          severity: warning
          level: P1
        annotations:
          summary: "订单接口 P99 延迟超过 500ms"
          description: "接口 {{ $labels.uri }} P99 延迟: {{ $value }}s"

      - alert: KafkaConsumerLag
        expr: kafka_consumer_group_lag{topic="order-events"} > 50000
        for: 10m
        labels:
          severity: warning
          level: P1
        annotations:
          summary: "Kafka 消费积压超过 50000"
          description: "Consumer Group {{ $labels.consumer_group }}, Topic {{ $labels.topic }}, Lag: {{ $value }}"

      # ===== P2 告警 =====
      - alert: HighJvmMemoryUsage
        expr: jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"} > 0.85
        for: 10m
        labels:
          severity: info
          level: P2
        annotations:
          summary: "JVM 堆内存使用率超过 85%"
          description: "实例 {{ $labels.instance }} 堆内存使用率: {{ $value | humanizePercentage }}"

      - alert: SlowQueries
        expr: rate(mysql_global_status_slow_queries[5m]) > 10
        for: 5m
        labels:
          severity: info
          level: P2
        annotations:
          summary: "MySQL 慢查询超过 10 次/分钟"
          description: "慢查询速率: {{ $value }}/min"
```

### 6.2 告警降噪策略

| 策略 | 配置 | 目的 |
|------|------|------|
| 告警分组 | 按 `alertname` + `severity` 分组 | 避免同一问题发送多条通知 |
| 告警抑制 | P0 告警触发时抑制同服务 P1/P2 告警 | 减少噪音，聚焦根因 |
| 静默窗口 | 计划维护期间设置 Maintenance Window | 避免发布期间告警风暴 |
| 重复间隔 | P0: 5min, P1: 15min, P2: 30min | 避免重复通知 |
| 升级机制 | P0 5min 未 Ack → 电话升级至 Tech Lead | 确保关键告警不被遗漏 |

### 6.3 值班与通知

| 告警级别 | 通知方式 | 响应时间 | 升级策略 |
|---------|---------|---------|---------|
| P0 (紧急) | 电话 + 钉钉 + 企微 | 5 分钟 | 10 分钟未 Ack → 升级至 Tech Lead |
| P1 (警告) | 钉钉 + 企微 | 15 分钟 | 30 分钟未 Ack → 升级至 Oncall 群 |
| P2 (提醒) | 钉钉 | 1 小时 | 不升级 |

---

## 7. Dashboard 配置

### 7.1 Dashboard 清单

| Dashboard 名称 | 目标用户 | 核心内容 | 粒度 |
|---------------|---------|---------|------|
| **订单服务 - 黄金信号** | 后端 / SRE | QPS, P99 延迟, Error Rate, JVM 指标 | 1min |
| **业务大盘** | 产品 / 运营 | 下单量、支付成功率、退款率、ARPU | 1h / 1d |
| **支付链路监控** | 后端 / 支付团队 | 支付成功率漏斗、渠道分布、金额统计 | 1min |
| **中间件健康度** | SRE / DBA | MySQL/Redis/Kafka/ES 关键指标 | 1min |
| **告警概览** | Oncall | 当前活跃告警、告警趋势、MTTR | 实时 |

### 7.2 订单服务黄金信号 Dashboard (Grafana JSON 模型参考)

```json
{
  "dashboard": {
    "title": "订单服务 - 黄金信号",
    "uid": "order-service-golden-signals",
    "panels": [
      {
        "title": "请求 QPS",
        "targets": [
          {
            "expr": "sum(rate(http_server_requests_seconds_count{job=\"order-service\"}[1m])) by (uri)",
            "legendFormat": "{{uri}}"
          }
        ],
        "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
        "type": "graph"
      },
      {
        "title": "P99 延迟",
        "targets": [
          {
            "expr": "histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{job=\"order-service\"}[1m])) by (le, uri))",
            "legendFormat": "{{uri}}"
          }
        ],
        "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 },
        "type": "graph",
        "thresholds": [
          { "value": 0.5, "color": "red", "op": "gt" }
        ]
      },
      {
        "title": "HTTP 错误率",
        "targets": [
          {
            "expr": "sum(rate(http_server_requests_seconds_count{job=\"order-service\",status=~\"5..\"}[1m])) / sum(rate(http_server_requests_seconds_count{job=\"order-service\"}[1m])) * 100",
            "legendFormat": "5xx Error Rate"
          }
        ],
        "gridPos": { "x": 0, "y": 8, "w": 8, "h": 6 },
        "type": "stat",
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 1, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "title": "JVM 堆内存",
        "targets": [
          {
            "expr": "jvm_memory_used_bytes{job=\"order-service\",area=\"heap\"} / jvm_memory_max_bytes{job=\"order-service\",area=\"heap\"} * 100",
            "legendFormat": "{{instance}}"
          }
        ],
        "gridPos": { "x": 8, "y": 8, "w": 8, "h": 6 },
        "type": "gauge",
        "fieldConfig": {
          "defaults": {
            "thresholds": {
              "steps": [
                { "value": 0, "color": "green" },
                { "value": 70, "color": "yellow" },
                { "value": 85, "color": "red" }
              ]
            }
          }
        }
      },
      {
        "title": "数据库连接池",
        "targets": [
          {
            "expr": "hikaricp_connections_active / hikaricp_connections_max * 100",
            "legendFormat": "{{pool}}"
          }
        ],
        "gridPos": { "x": 16, "y": 8, "w": 8, "h": 6 },
        "type": "gauge"
      }
    ]
  }
}
```

### 7.3 业务大盘核心 Panel 说明

| Panel | 可视化类型 | 数据源 | 说明 |
|-------|----------|--------|------|
| 实时订单滚动 | Stat (数字) | Prometheus | 今日订单量，对比昨日同期 |
| 订单趋势 | Graph (折线图) | Prometheus | 24h 订单量波动，标注环比 |
| 支付成功率 | Gauge (仪表盘) | Prometheus | 当前支付成功率，< 95% 红色告警 |
| 支付转化漏斗 | Funnel Panel | Prometheus | 下单→支付→完成 各阶段转化率 |
| 退款率趋势 | Graph | Prometheus | 近 7 天退款率，5% 阈值线 |
| TOP 错误接口 | Table | Prometheus | 按错误率排序，含错误码分布 |

---

## 8. 监控健康检查

### 8.1 监控系统自检

<!-- 确保监控系统本身可用，避免"监控不可用才发现问题" -->

```bash
#!/bin/bash
# 监控系统健康检查脚本 (Cron 每 5 分钟执行)

PROMETHEUS_HEALTH=$(curl -s http://prometheus:9090/-/healthy)
GRAFANA_HEALTH=$(curl -s http://grafana:3000/api/health)
JAEGER_HEALTH=$(curl -s http://jaeger:16686/)

if [ "$PROMETHEUS_HEALTH" != "Prometheus Server is Healthy." ]; then
    echo "ERROR: Prometheus 不可用" && exit 1
fi

if [ "$GRAFANA_HEALTH" != *"ok"* ]; then
    echo "ERROR: Grafana 不可用" && exit 1
fi

echo "监控系统健康检查通过 ✓"
```

| 检查项 | 方法 | 频率 | 告警 |
|--------|------|------|------|
| Prometheus 健康 | GET /-/healthy | 1 min | 不可用 → P0 电话 |
| Grafana 可用性 | GET /api/health | 1 min | 不可用 → P1 钉钉 |
| Jaeger 可用 | 检查 Collector 端口 | 5 min | 不可用 → P1 钉钉 |
| 告警规则有效性 | Prometheus AlertManager API | 每天 | 无活跃规则 → P2 |
