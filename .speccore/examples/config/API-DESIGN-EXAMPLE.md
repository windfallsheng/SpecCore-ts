# API 设计规范示例

> 本文件为 RESTful API 设计规范示例，供新项目参考。
> 复制到项目后按需修改，或作为 `.speccore/RULES/api-design.md` 的素材。

---

## 1. 基础规范

### 1.1 URL 设计

- **全部小写**，使用短横线 `-` 分隔单词
- **资源名用复数**：`/users` `/orders` `/products`
- **避免动词**：用 HTTP 方法表达动作，不要写 `/getUsers` `/createOrder`
- **嵌套不超过 3 层**：`/users/{id}/orders/{orderId}/items` ✅，`/users/{id}/orders/{orderId}/items/{itemId}/reviews/{reviewId}` ❌

```
GET    /users              # 列表
GET    /users/{id}         # 详情
POST   /users              # 创建
PUT    /users/{id}         # 全量更新
PATCH  /users/{id}         # 部分更新
DELETE /users/{id}         # 删除
```

### 1.2 HTTP 状态码

| 状态码 | 场景 | 说明 |
|:---|:---|:---|
| `200` | 成功 | GET/PUT/PATCH/DELETE 成功 |
| `201` | 创建成功 | POST 创建资源成功 |
| `204` | 无内容 | DELETE 成功，不返回 body |
| `400` | 参数错误 | 请求参数校验失败 |
| `401` | 未认证 | Token 缺失或过期 |
| `403` | 无权限 | 已登录但无权访问 |
| `404` | 不存在 | 资源不存在 |
| `409` | 冲突 | 资源已存在或状态冲突 |
| `422` | 业务规则冲突 | 请求语法正确但业务规则不允许 |
| `429` | 限流 | 请求过于频繁 |
| `500` | 系统错误 | 服务端未捕获异常 |

### 1.3 请求/响应格式

**请求头必备：**
```
Content-Type: application/json
Authorization: Bearer {token}
X-Request-Id: {uuid}          # 链路追踪 ID
X-Client-Version: 1.2.0       # 客户端版本（可选）
```

**统一响应体：**
```json
{
  "success": true,
  "code": "OK",
  "message": "success",
  "data": { ... },
  "traceId": "req-abc123",
  "timestamp": "2026-09-10T12:00:00Z"
}
```

**错误响应体：**
```json
{
  "success": false,
  "code": "BIZ_001",
  "message": "参数校验失败",
  "details": [
    { "field": "phone", "message": "手机号格式不正确" }
  ],
  "traceId": "req-abc123",
  "timestamp": "2026-09-10T12:00:00Z"
}
```

---

## 2. 分页规范

**请求：**
```
GET /users?page=1&pageSize=20&sort=createdAt,desc&sort=name,asc
```

**响应：**
```json
{
  "success": true,
  "data": {
    "list": [ ... ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 156,
      "totalPages": 8,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

**规则：**
- `page` 从 1 开始，不是 0
- `pageSize` 默认 20，最大 100
- `sort` 支持多字段，格式 `字段名,asc|desc`
- 不分页接口必须显式声明，默认都分页

---

## 3. 鉴权规范

### 3.1 Token 机制

- **Access Token：** JWT，有效期 2 小时，放在 `Authorization: Bearer {token}`
- **Refresh Token：** 有效期 7 天，用于换取新的 Access Token
- **Token 刷新：** 返回 401 时，客户端用 Refresh Token 换取新 Access Token，重试原请求

### 3.2 接口鉴权分级

| 级别 | 说明 | 示例 |
|:---|:---|:---|
| `public` | 无需登录 | 登录接口、注册接口、公开数据 |
| `user` | 需登录 | 查看自己的订单、修改个人资料 |
| `admin` | 需管理员权限 | 用户管理、系统配置 |
| `super` | 需超级管理员 | 删除组织、修改全局配置 |

### 3.3 权限校验顺序

1. 校验 Token 有效性（是否过期、是否被吊销）
2. 校验接口访问权限（该角色能否访问此接口）
3. 校验数据权限（该用户能否操作此数据）
4. 记录审计日志（谁、什么时间、访问了什么）

---

## 4. 版本控制

### 4.1 URL 路径版本（推荐）

```
/v1/users
/v2/users
```

### 4.2 Header 版本（备选）

```
Accept: application/json; version=2.0
```

**规则：**
- 主版本号变更（v1 → v2）才改 URL，内部迭代不改
- 老版本保留至少 6 个月，给客户端迁移时间
- 版本文档必须说明各版本差异和废弃计划

---

## 5. 文件上传

### 5.1 直接上传（小文件 < 5MB）

```
POST /files
Content-Type: multipart/form-data

file: (binary)
folder: avatars        # 业务目录
```

### 5.2 预签名上传（大文件 > 5MB）

```
POST /files/presign
{
  "filename": "report.pdf",
  "size": 10485760,
  "mimeType": "application/pdf"
}

# 返回预签名 URL，客户端直传 OSS/S3
{
  "success": true,
  "data": {
    "uploadUrl": "https://oss.example.com/...",
    "fileUrl": "https://cdn.example.com/files/xxx.pdf",
    "expiresAt": "2026-09-10T12:05:00Z"
  }
}
```

**规则：**
- 限制文件类型（白名单）
- 限制文件大小（单文件最大 50MB）
- 图片自动压缩、生成缩略图
- 敏感文件（身份证、营业执照）加密存储

---

## 6. 幂等性设计

### 6.1 幂等键（Idempotency-Key）

```
POST /orders
Idempotency-Key: {uuid}

{
  "productId": 123,
  "quantity": 2
}
```

**规则：**
- 客户端生成唯一键，服务端缓存结果 24 小时
- 相同幂等键重复请求，返回相同结果（不重复执行业务）
- 适用于：支付、下单、转账等关键操作

### 6.2 乐观锁（Version）

```
PUT /users/{id}
{
  "name": "张三",
  "version": 5
}
```

- 更新时校验 `version`，不一致返回 `409 Conflict`
- 适用于：并发修改同一资源的场景

---

## 7. 批量操作

### 7.1 批量查询

```
GET /users?ids=1,2,3,4,5
```

- `ids` 最多 100 个
- 超过 100 个返回 `400`，提示分批查询

### 7.2 批量创建/更新/删除

```
POST /users/batch
{
  "items": [
    { "name": "张三", "phone": "13800138001" },
    { "name": "李四", "phone": "13800138002" }
  ]
}
```

**规则：**
- 批量最多 100 条
- 部分失败返回 `207 Multi-Status`，明细说明每条结果
- 全部失败返回 `400`，不执行任何操作（事务回滚）

---

## 8. 限流与熔断

### 8.1 限流规则

| 级别 | 阈值 | 说明 |
|:---|:---|:---|
| IP 级 | 100 次/分钟 | 防止单 IP 刷接口 |
| 用户级 | 1000 次/分钟 | 正常用户足够，异常行为拦截 |
| 接口级 | 根据业务设定 | 如短信接口 5 次/小时 |

### 8.2 熔断策略

- 错误率 > 50% 持续 1 分钟 → 熔断 30 秒
- 熔断期间返回 `503`，提示"服务暂不可用"
- 熔断恢复后，先放行少量请求探测，正常后全开

---

## 9. 接口文档规范

### 9.1 文档必备内容

每个接口文档必须包含：
1. **接口描述** — 一句话说明功能
2. **请求方法 + URL** — 含路径参数说明
3. **请求头** — 必填头列表
4. **请求参数** — Query / Body / Path，含类型、必填、示例、约束
5. **响应体** — 成功 + 失败示例
6. **错误码** — 该接口可能返回的所有错误码
7. **权限要求** — public / user / admin / super
8. **幂等性** — 是否幂等，幂等键要求

### 9.2 示例模板

```markdown
### 创建订单

**接口描述：** 用户创建新订单

**请求：**
```
POST /v1/orders
Authorization: Bearer {token}
Idempotency-Key: {uuid}
```

**请求体：**
| 字段 | 类型 | 必填 | 说明 | 示例 |
|:---|:---|:---:|:---|:---|
| productId | long | ✅ | 商品 ID | 123 |
| quantity | int | ✅ | 数量，1~99 | 2 |
| remark | string | ❌ | 订单备注，≤200字 | "请尽快发货" |

**响应：**
```json
{
  "success": true,
  "data": {
    "orderId": "ORD-20260910-001",
    "status": "PENDING_PAYMENT",
    "totalAmount": 19900,
    "createdAt": "2026-09-10T12:00:00Z"
  }
}
```

**错误码：**
| 错误码 | 说明 |
|:---|:---|
| BIZ_001 | productId 不存在 |
| BIZ_005 | 库存不足 |
| BIZ_003 | 重复提交（相同幂等键） |
```
