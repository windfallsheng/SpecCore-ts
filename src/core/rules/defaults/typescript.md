---
appliesTo:
  - typescript
  - ts
priority: 100
---

# TypeScript 编码规范

## 类型安全

- **禁止 `any`**：除非与第三方库交互，否则不使用 `any`。使用 `unknown` + 类型守卫替代。
- **禁止 `@ts-ignore`**：必须使用 `@ts-expect-error` 并附注释说明原因。
- **严格模式**：项目必须开启 `strict: true`。
- **显式返回类型**：公共 API 函数必须声明返回类型。

## 命名规范

- 类型/接口：`PascalCase`（如 `UserProfile`）
- 变量/函数：`camelCase`（如 `getUserName`）
- 常量：`UPPER_SNAKE_CASE`（如 `MAX_RETRY_COUNT`）
- 枚举：`PascalCase`，成员 `UPPER_SNAKE_CASE`
- 布尔变量：使用 `is`、`has`、`should` 前缀（如 `isLoading`）

## 模块组织

- 一个文件一个核心导出（类/函数/组件）
- 工具函数按领域分组（`utils/validation.ts`、`utils/date.ts`）
-  barrel export 使用 `index.ts` 统一暴露模块公共 API
- 禁止循环依赖

## 异步规范

- 优先使用 `async/await`，避免回调地狱
- Promise 链必须有 `.catch()` 或 `try/catch`
- 并行请求使用 `Promise.all()`，但注意错误处理
