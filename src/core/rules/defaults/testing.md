---
appliesTo:
  - test
  - jest
  - vitest
  - testing
priority: 60
---

# 测试规范

## 测试策略

- **测试金字塔**：单元测试（70%）→ 集成测试（20%）→ E2E 测试（10%）。
- **覆盖目标**：核心业务逻辑覆盖率 ≥ 80%，分支覆盖率 ≥ 70%。
- **测试文件名**：`{module}.test.ts` 或 `{module}.spec.ts`，与源码同目录或 `__tests__/` 下。

## 单元测试

- **独立性**：每个测试用例独立，不依赖执行顺序。
- **Arrange-Act-Assert**：三段式结构清晰。
- **Mock 外部依赖**：HTTP 请求、数据库、文件系统必须 Mock。
- **命名规范**：`should {预期行为} when {条件}`，如 `should return 401 when token is expired`。

## 集成测试

- **真实依赖**：使用测试数据库（如 SQLite 内存 / TestContainers）。
- **环境隔离**：每个测试套件前清理数据，后回滚事务。
- **API 契约**：验证请求/响应格式符合 OpenAPI 定义。

## 禁止

- 不在测试中写逻辑（如 if/for），只调用和断言。
- 不测试第三方库（如测试 `lodash` 的 `debounce`）。
- 不提交 `.only`、`.skip` 到主分支。
