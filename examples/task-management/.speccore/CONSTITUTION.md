# 技术宪法

> 本项目遵循 SpecCore 框架规范，所有变更需更新对应 Spec 文件。

## 技术栈

| 层级 | 技术 | 版本 |
| :--- | :--- | :--- |
| 后端框架 | Spring Boot | 3.2.x |
| 语言 | Java | 17 |
| 数据库 | MySQL | 8.0 |
| ORM | MyBatis-Plus | 3.5.x |
| 前端框架 | Vue | 3.x |
| UI 库 | Element Plus | 2.x |
| 构建 | Maven + Vite | latest |
| 部署 | Docker Compose | — |

## 代码规范

- Java: 阿里巴巴 Java 开发手册
- 前端: Vue 3 Composition API + script setup
- REST API: 统一返回 { code, message, data }
- 数据库: 下划线命名 → Java 驼峰命名

## Spec 规范

- REQ.md: 需求文档（背景 + 功能 + 验收标准）
- TECH.md: 技术方案（数据模型 + 分层设计 + 关键决策）
- TASK.md: 任务分解（子任务清单 + 工时 + 依赖关系）
- API_CONTRACT.yaml: 接口契约

## 禁止事项

- 不经过 Spec 直接写代码
- Spec 与实际代码不同步
- 跳过 validate 提交代码
