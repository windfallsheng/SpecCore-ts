# 项目团队与 Git 账号映射

> **用途**：用于 `/spec-plan` 任务分配和 `/spec-review` 执行人验证。
> **规则**：`Git 账号` 必须与 `git config user.name` 严格匹配。

## 团队成员

| 姓名 | Git 账号 (user.name) | Git 邮箱 (user.email) | 主要技能 | 可承担角色 |
| :--- | :--- | :--- | :--- | :--- |
| 张三 | `zhangsan` | `zhangsan@company.com` | Java, Spring Boot, MySQL | 后端/全栈 |
| 李四 | `lisi` | `lisi@company.com` | Java, Redis, 微服务 | 后端 |
| 王五 | `wangwu` | `wangwu@company.com` | Vue, TypeScript, CSS | 前端 |

## 默认分配策略（供 `/spec-plan` 参考）

- **后端任务**：优先分配给 `zhangsan` 或 `lisi`
- **前端任务**：优先分配给 `wangwu`
- **全栈任务**：优先分配给 `zhangsan`（资源冲突时可拆分为前后端子任务）

## 团队变更记录

| 日期 | 操作 | 人员 | 变更人 |
| :--- | :--- | :--- | :--- |
