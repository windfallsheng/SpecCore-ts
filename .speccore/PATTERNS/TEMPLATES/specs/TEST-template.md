# 测试计划

<!--
  参考格式，最终内容由 AI 根据实际需求自由组织
  本模板覆盖功能测试、边界测试、性能测试、安全测试，适用于敏捷迭代中的 QA 流程
-->

---

## 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
|------|------|--------|----------|
| v1.0 | 2026-01-25 | 张三（QA） | 初稿，基于技术方案 v1.2 和需求分析 v1.2 编写 |
| v1.1 | 2026-01-30 | 李四（QA） | 补充性能测试策略和 E2E 测试场景 |
| v1.2 | 2026-02-03 | 王五（QA Lead） | 评审后增加安全测试用例和环境规划 |

---

## 1. 测试范围

### 1.1 测试范围说明

| 维度 | 包含范围 | 不包含范围 | 原因 |
|------|---------|-----------|------|
| 功能模块 | 订单管理、支付处理、退款管理 | 商品管理后台 | 商品管理独立迭代 |
| 测试类型 | 单元测试、集成测试、E2E 测试、性能测试、安全测试 | 兼容性测试（移动端） | 移动端专项测试另行安排 |
| 接口 | 7 个对外 REST API | 内部 Kafka 消息 | 消息由消费端自行测试 |
| 环境 | DEV / TEST / STAGING | PROD | 生产环境仅做监控验证 |

### 1.2 测试目标

| 目标 | 指标 | 阈值 |
|------|------|------|
| 功能测试覆盖率 | 用户故事覆盖率 | 100% |
| 代码覆盖率 | 行覆盖率 | ≥ 80% |
| 核心路径覆盖率 | 分支覆盖率 | ≥ 90% |
| 严重缺陷修复率 | P0/P1 缺陷关闭率 | 100% |
| 性能基准达标 | P99 延迟 | ≤ 技术方案要求 |

---

## 2. 测试策略

### 2.1 测试金字塔

```
           ┌──────┐
           │ E2E  │  10%  — 核心业务全链路 (Cypress)
           ├──────┤
           │ 集成  │  30%  — 服务间接口 + DB (SpringBootTest + Testcontainers)
           ├──────┤
           │ 单元  │  60%  — Service/Repository 层 (JUnit 5 + Mockito)
           └──────┘
```

### 2.2 测试分层策略

| 测试层级 | 覆盖内容 | 工具 | 执行时机 | 执行频率 |
|---------|---------|------|---------|---------|
| L0 - 单元测试 | Service、Repository、Util 类 | JUnit 5 + Mockito + AssertJ | 本地开发 | 每次提交 |
| L1 - API 集成测试 | Controller + DB + Redis | SpringBootTest + Testcontainers | CI Pipeline | 每次 MR |
| L2 - 契约测试 | 服务间接口兼容性 | Pact | CI Pipeline | 每次 MR |
| L3 - E2E 测试 | 核心业务全链路 | Cypress | 每日构建 | 每天一次 |
| L4 - 性能测试 | 关键接口压力测试 | JMeter + Grafana k6 | 提测前 | 每版本一次 |
| L5 - 安全测试 | SQL 注入/XSS/CSRF | OWASP ZAP + 手动 | 提测前 | 每版本一次 |

---

## 3. 功能测试用例

### 3.1 订单创建模块

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 测试数据 |
|---------|---------|---------|---------|---------|--------|---------|
| TC-ORDER-001 | 正常创建订单-单商品 | 用户已登录，SKU 有库存 | 1. 选择商品 SKU-001，数量 1；2. 填写完整收货地址；3. 提交订单 | HTTP 201，返回订单号和金额，状态为 PENDING_PAYMENT | P0 | customerId=cust_001, skuId=SKU-001, qty=1 |
| TC-ORDER-002 | 正常创建订单-多商品 | 用户已登录，多个 SKU 有库存 | 1. 选择 SKU-001 (qty=2) + SKU-002 (qty=1)；2. 提交订单 | 返回订单总金额为 SKU-001*2 + SKU-002 之和 | P0 | customerId=cust_001, items=[{skuId:SKU-001,qty:2},{skuId:SKU-002,qty:1}] |
| TC-ORDER-003 | 使用优惠券创建订单 | 用户持有有效优惠券 PROMO2026 | 1. 选择商品；2. 输入优惠券码 PROMO2026；3. 提交订单 | 订单金额正确扣减 20 元，优惠券标记已使用 | P1 | couponCode=PROMO2026, discountAmount=20.00 |
| TC-ORDER-004 | 下单时库存不足 | SKU-001 库存为 1 | 1. 选择 SKU-001，数量设为 5；2. 提交订单 | HTTP 400，错误码 40001，提示"库存不足，当前库存: 1" | P0 | skuId=SKU-001, qty=5, stock=1 |
| TC-ORDER-005 | 未登录创建订单 | 无有效 Token | 1. 不携带 Authorization Header；2. 调用创建订单接口 | HTTP 401，提示"请先登录" | P1 | Authorization=空 |
| TC-ORDER-006 | 幂等性验证 | 已创建过订单 | 1. 使用相同 Idempotency-Key 重复调用创建接口；2. 间隔 1 秒再次调用 | 两次请求返回相同订单信息，不会重复创建 | P1 | Idempotency-Key=test-key-001 |
| TC-ORDER-007 | 收货地址不完整 | 用户已登录 | 1. 填写收货地址仅含省份，缺少市/区；2. 提交订单 | HTTP 400，提示"请填写完整收货地址" | P1 | shippingAddress={province:"广东省"} |

### 3.2 支付处理模块

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 测试数据 |
|---------|---------|---------|---------|---------|--------|---------|
| TC-PAY-001 | 正常微信支付 | 存在待支付订单 ORD-001 | 1. 发起微信支付；2. 模拟微信支付成功回调 | 支付状态变为 SUCCESS，订单状态变为 PAID | P0 | orderNo=ORD-001, channel=WEPAY, amount=178.00 |
| TC-PAY-002 | 支付超时自动取消 | 订单 ORD-002 待支付，expire_time=当前时间-1分钟 | 1. 等待定时任务执行；2. 查询订单状态 | 订单状态变为 CANCELLED，库存释放 | P0 | orderNo=ORD-002 |
| TC-PAY-003 | 支付回调签名校验失败 | 订单 ORD-001 待支付 | 1. 发送篡改签名的回调请求 | HTTP 401，提示"签名校验失败" | P1 | X-Signature=invalid_signature |

### 3.3 退款模块

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 测试数据 |
|---------|---------|---------|---------|---------|--------|---------|
| TC-REFUND-001 | 全额退款 | 订单已支付，实付 178.00 | 1. 申请全额退款；2. 运营审核通过 | 支付记录状态变为 REFUNDED，订单状态变为 REFUNDED | P0 | orderNo=ORD-001, refundAmount=178.00 |
| TC-REFUND-002 | 部分退款 | 订单已支付，实付 178.00 | 1. 申请退款 50.00；2. 运营审核通过 | 支付记录状态 REFUNDED，退款金额 50.00 | P1 | orderNo=ORD-002, refundAmount=50.00 |
| TC-REFUND-003 | 退款金额超实付 | 订单已支付，实付 178.00 | 1. 申请退款 200.00 | HTTP 400，提示"退款金额不得高于实付金额" | P1 | refundAmount=200.00 |

---

## 4. 边界测试

### 4.1 输入边界测试

| 用例编号 | 测试场景 | 输入值 | 预期结果 |
|---------|---------|--------|---------|
| BT-INPUT-001 | 订单商品数量为 0 | items[].quantity = 0 | HTTP 400，参数校验失败 |
| BT-INPUT-002 | 订单商品数量为极大值 | items[].quantity = 999999 | HTTP 400，超过单次购买上限 |
| BT-INPUT-003 | 收货人姓名为空字符串 | recipient = "" | HTTP 400，参数校验失败 |
| BT-INPUT-004 | 收货人姓名超长 | recipient = 500 个中文字符 | HTTP 400，超过最大长度限制 |
| BT-INPUT-005 | 手机号格式错误 | phone = "12345" | HTTP 400，手机号格式校验失败 |
| BT-INPUT-006 | 订单金额为 0 | 全免单场景 | 允许创建（0 元订单状态直接为 PAID） |
| BT-INPUT-007 | 单次请求包含 100 个商品 | items.length = 100 | HTTP 400，超过最大商品数限制 |

### 4.2 并发边界测试

| 用例编号 | 测试场景 | 并发条件 | 预期结果 |
|---------|---------|---------|---------|
| BT-CONC-001 | 并发下单扣库存 | 库存=1，100 并发下单 | 仅 1 个订单创建成功，其余返回库存不足 |
| BT-CONC-002 | 重复支付 | 同一订单 10 并发支付请求 | 仅 1 次支付被处理，其余返回幂等响应 |
| BT-CONC-003 | 并发退款 | 同一已支付订单 5 并发退款请求 | 仅 1 次退款成功 |

---

## 5. 性能测试

### 5.1 性能测试场景

| 场景编号 | 场景描述 | 并发用户数 | 持续时间 | 目标指标 |
|---------|---------|----------|---------|---------|
| PERF-001 | 订单创建基准测试 | 500 → 2000 → 5000 | 每个档位 10 分钟 | P99 ≤ 500ms，错误率 < 0.1% |
| PERF-002 | 订单查询混合负载 | 10000 持续请求 | 30 分钟 | P99 ≤ 200ms，CPU < 70% |
| PERF-003 | 支付回调压力测试 | 2000 QPS 突发 | 5 分钟 | TPS ≥ 2000，无消息积压 |
| PERF-004 | 长时间稳定性测试 | 500 正常负载 | 24 小时 | 无内存泄漏，连接池正常回收 |

### 5.2 JMeter 测试脚本示例

```xml
<!-- 订单创建接口 JMeter 测试计划片段 -->
<HTTPSamplerProxy guiclass="HttpTestSampleGui" testname="Create Order">
  <elementProp name="HTTPsampler.Arguments">
    <collectionProp name="Arguments.arguments">
      <elementProp name="Idempotency-Key" always_encode="true">
        <stringProp name="Header.value">${__UUID}</stringProp>
      </elementProp>
    </collectionProp>
  </elementProp>
  <stringProp name="HTTPSampler.domain">api.example.com</stringProp>
  <stringProp name="HTTPSampler.port">443</stringProp>
  <stringProp name="HTTPSampler.protocol">https</stringProp>
  <stringProp name="HTTPSampler.path">/v1/orders</stringProp>
  <stringProp name="HTTPSampler.method">POST</stringProp>
  <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
</HTTPSamplerProxy>
```

### 5.3 Grafana k6 脚本示例

```javascript
// k6 性能测试脚本
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '3m', target: 500 },   // 预热
    { duration: '5m', target: 2000 },  // 加压
    { duration: '5m', target: 2000 },  // 保持
    { duration: '3m', target: 0 },     // 冷却
  ],
  thresholds: {
    http_req_duration: ['p(99)<500'],  // P99 < 500ms
    http_req_failed: ['rate<0.001'],   // 错误率 < 0.1%
  },
};

export default function () {
  const payload = JSON.stringify({
    customerId: `cust_${__VU}_${__ITER}`,
    items: [{ skuId: 'SKU-001', quantity: 1, unitPrice: 99.00 }],
    shippingAddress: {
      recipient: '测试用户',
      phone: '13800138000',
      province: '广东省',
      city: '深圳市',
      district: '南山区',
      detail: '科技园1号',
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${__ENV.TEST_TOKEN}`,
      'Idempotency-Key': `${__VU}_${__ITER}_${Date.now()}`,
    },
  };

  const res = http.post('https://api.example.com/v1/orders', payload, params);
  check(res, { 'status is 201': (r) => r.status === 201 });
  sleep(1);
}
```

---

## 6. 安全测试

### 6.1 安全测试用例

| 用例编号 | 测试项 | 攻击向量 | 测试方法 | 预期结果 |
|---------|--------|---------|---------|---------|
| SEC-001 | SQL 注入 | `' OR '1'='1` 注入参数 | 在订单号查询参数中注入 | 参数化查询拦截，返回空结果 |
| SEC-002 | XSS 攻击 | `<script>alert(1)</script>` 注入 | 在收货地址字段注入脚本 | 输出编码，脚本不被执行 |
| SEC-003 | CSRF 攻击 | 跨站伪造请求 | 不带 Referer/Origin 头发送 POST | 返回 403 Forbidden |
| SEC-004 | JWT 篡改 | 修改 JWT Payload 后重放 | 使用伪造签名的 Token | 返回 401 Unauthorized |
| SEC-005 | 越权访问 | 用户 A 查看用户 B 的订单 | 修改 orderId 参数 | 返回 403，提示无权访问 |
| SEC-006 | 重放攻击 | 重复发送相同支付回调 | 使用过期的时间戳 | 返回 400，Nonce 已使用 |
| SEC-007 | 敏感信息泄露 | 查看 API 错误响应 | 触发各类异常 | 错误信息不含堆栈、SQL、密钥等 |

### 6.2 OWASP ZAP 扫描配置

```bash
# OWASP ZAP 自动化安全扫描命令
zap-cli quick-scan --self-contained \
  --start-options "-config api.disablekey=true" \
  --spider https://staging-api.example.com/v1/orders \
  --scanners all \
  --output-format json \
  --output-file security-report.json
```

---

## 7. 测试环境

### 7.1 环境配置

| 环境 | 用途 | 数据库 | 缓存 | 消息队列 | 外部依赖 |
|------|------|--------|------|---------|---------|
| DEV | 开发自测 | MySQL 8.0 (Docker) | Redis single | Kafka single | Mock 支付网关、Mock 物流 |
| TEST | 功能测试 | MySQL 8.0 (Docker Compose) | Redis single | Kafka single | Mock 支付网关、真实物流 Sandbox |
| STAGING | 预发布测试 | MySQL 8.0 (读写分离) | Redis Cluster (3 节点) | Kafka Cluster (3 节点) | 微信支付 Sandbox、物流 Sandbox |

### 7.2 Testcontainers 配置示例

```java
// 集成测试中使用 Testcontainers 启动依赖
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class OrderServiceIntegrationTest {

    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0.33")
            .withDatabaseName("order_test")
            .withUsername("test")
            .withPassword("test");

    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7.2-alpine")
            .withExposedPorts(6379);

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", mysql::getJdbcUrl);
        registry.add("spring.datasource.username", mysql::getUsername);
        registry.add("spring.datasource.password", mysql::getPassword);
        registry.add("spring.redis.host", redis::getHost);
        registry.add("spring.redis.port", () -> redis.getMappedPort(6379));
    }

    @Test
    void shouldCreateOrderSuccessfully() {
        // 测试逻辑...
    }
}
```

---

## 8. 测试数据准备

### 8.1 基础测试数据

| 数据类型 | 数据内容 | 数据量 | 生成方式 |
|---------|---------|--------|---------|
| 用户数据 | 普通用户、VIP 用户、风控用户 | 100 条 | SQL 脚本导入 |
| 商品数据 | 有库存商品、无库存商品、下架商品 | 50 条 | SQL 脚本导入 |
| 优惠券数据 | 满减券、折扣券、过期券 | 20 条 | SQL 脚本导入 |
| 订单数据 | 各状态订单（待支付/已支付/已发货/已完成/已取消） | 500 条 | 数据工厂脚本生成 |
| 性能压测数据 | 批量用户 + 批量商品 | 10 万用户 + 1 万商品 | Python 脚本批量生成 |

### 8.2 数据清理策略

<!-- 每次测试完成后需确保环境恢复干净，避免数据污染影响下一轮测试 -->

| 测试类型 | 清理策略 | 清理方式 |
|---------|---------|---------|
| 单元测试 | 自动回滚 | @Transactional + @Rollback |
| 集成测试 | 自动回滚或重建 | Testcontainers 用完即销毁 |
| E2E 测试 | 手动/脚本清理 | @AfterAll 调用清理接口 |
| 性能测试 | 脚本清理 + 重建 | 压测前后对比数据量，逐表 TRUNCATE |
