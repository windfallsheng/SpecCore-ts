---
appliesTo:
  - api
  - rest
  - graphql
priority: 70
---

# API 设计规范

## 通用原则

- **幂等性**：GET/PUT/DELETE 必须幂等；POST 非幂等但需防重放。
- **版本控制**：URL 路径版本（`/api/v1/`）或 Header 版本（`Accept: application/vnd.api.v1+json`）。
- **分页规范**：
  ```
  GET /api/v1/users?page=1&size=20
  Response: { "data": [], "pagination": { "page": 1, "size": 20, "total": 100 } }
  ```

## 请求规范

- **Content-Type**：JSON API 统一使用 `application/json`。
- **字段命名**：camelCase（JavaScript/TypeScript）或 snake_case（Python/Java），全项目统一。
- **批量操作**：使用 `POST /batch` 或 `PATCH` 批量更新，限制单次批量大小（最大 100）。

## 响应规范

- **成功响应**：HTTP 200 + 业务 code 0。
- **错误响应**：HTTP 4xx/5xx + 结构化错误信息：
  ```json
  {
    "code": 1001,
    "message": "用户不存在",
    "details": { "field": "userId", "issue": "not_found" }
  }
  ```
- **空列表**：返回空数组 `[]`，不要返回 null 或 404。

## 安全

- **鉴权**：使用 JWT / OAuth2，Token 放在 `Authorization: Bearer <token>`。
- **限流**：关键接口必须配置 Rate Limiting（如 100 req/min）。
- **CORS**：显式配置允许的 Origin，禁止 `*` 在生产环境使用。
