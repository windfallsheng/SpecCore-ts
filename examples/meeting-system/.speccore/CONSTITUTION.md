# 技术宪法 — 会议预订系统

> 本项目遵循 SpecCore 框架规范。此文件为全局技术约束，AI 在所有 Task 中自动遵守。

---

## 技术栈

### 后端 (backend)
- 语言: Java 17
- 框架: Spring Boot 3.2
- ORM: MyBatis-Plus 3.5
- 数据库: MySQL 8.0 · 缓存: Redis 7

### 前端
| 平台 | 框架 | UI 组件 |
| :--- | :--- | :--- |
| frontend-web | Vue 3 + TypeScript + Vite | Element Plus |
| frontend-h5 | Vue 3 + Vite | Vant 4 |

---

## 命名规范

| 层级 | 规范 | 示例 |
| :--- | :--- | :--- |
| Controller | `{模块}Controller` | `RoomController` |
| Service | `{模块}Service` + `{模块}ServiceImpl` | `RoomService` / `RoomServiceImpl` |
| Repository | `{模块}Repository extends BaseMapper<{实体}>` | `RoomRepository` |
| DTO | `Create{实体}DTO` / `Update{实体}DTO` / `{实体}PageDTO` | `CreateRoomDTO` |
| 数据库表 | `t_` 前缀 + 英文复数 | `t_rooms` |
| API 路径 | `/api/v1/{模块}/{操作}` | `/api/v1/rooms/list` |

---

## 代码规范（AI 自动注入）

<!-- spec-rule: exception-handler -->
- 统一异常: Controller 抛出 `BusinessException`
- 全局捕获: `@ControllerAdvice` → `{ code, message, data }`
- 禁止: 返回 null、catch 后吞掉异常
<!-- /spec-rule -->

<!-- spec-rule: response-format -->
- 统一返回: `Result<T>` = `{ code, message, data }`
- 分页: `PageResult<T>` = `{ code, message, data: { records, total, page, size } }`
<!-- /spec-rule -->

<!-- spec-rule: orm -->
- ORM: MyBatis-Plus 3.5 · 禁止手写 SQL（复杂报表除外）
- 逻辑删除: `@TableLogic` · 自动填充: `@TableField(fill = FieldFill.INSERT)`
<!-- /spec-rule -->

<!-- spec-rule: validation -->
- Controller 层: `@Valid` + JSR-303
- Service 层: `BusinessException` 处理业务校验
<!-- /spec-rule -->

<!-- spec-rule: git-branch -->
- 分支格式: `{YYYYMMDD}-{任务名}-{姓名缩写}` · 示例: `260722-会议室管理-zs`
<!-- /spec-rule -->

---

## 异常码体系

| 错误码 | 含义 | 场景 |
| :--- | :--- | :--- |
| 1001 | 会议室不存在 | 查询/编辑/删除不存在的会议室 |
| 1002 | 会议室名称重复 | 新增时名称已存在 |
| 2001 | 预订时间冲突 | 同会议室同时间段已被预订 |
| 2002 | 预订不存在 | 取消/查看不存在的预订 |
| 2003 | 不可预订过去时间 | 预订时间早于当前时间 |
| 4001 | 参数校验失败 | @Valid 不通过 |

---

| 时间 | 变更内容 | 类型 | 版本 |
| :--- | :--- | :--- | :--- |
| 2026-07-22 | 初始创建，定义会议系统宪法 | 新增 | v1.0 |
