---
appliesTo:
  - nodejs
  - node
  - nestjs
  - express
priority: 80
---

# Node.js / NestJS 服务端规范

## API 设计

- **RESTful 标准**：使用 HTTP 方法表达语义（GET/POST/PUT/DELETE/PATCH）。
- **路由规范**：`/api/v{版本}/{模块}/{资源}`，如 `/api/v1/users`。
- **状态码**：正确使用 HTTP 状态码（200/201/204/400/401/403/404/409/422/500）。
- **统一响应格式**：
  ```json
  { "code": 0, "data": {}, "message": "ok" }
  ```

## 错误处理

- **全局异常过滤器**：NestJS 使用 `ExceptionFilter`，Express 使用中间件。
- **业务异常**：自定义 `BusinessException`，必须包含错误码和可读消息。
- **不暴露内部错误**：生产环境不返回堆栈信息。

## 依赖注入

- **NestJS**：优先使用构造函数注入，避免 `@Inject()` 字符串令牌。
- **分层架构**：Controller → Service → Repository，禁止跨层调用。
- **接口隔离**：Service 层面向接口编程，便于测试和替换。

## 数据访问

- **ORM 优先**：使用 TypeORM / Prisma / Sequelize，禁止裸写 SQL（复杂查询除外）。
- **事务边界**：多表操作必须使用事务，通过装饰器或显式事务管理。
- **N+1 防护**：使用 `relations` + `select` 或 DataLoader 避免 N+1 查询。
