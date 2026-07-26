# 技术宪法 — 会议预订系统

> 项目遵循 SpecCore 框架规范。此文件为全局技术约束，AI 在所有 Task 中自动遵守。

---

## 技术栈

### 后端 (backend)
- 语言: Java 17
- 框架: Spring Boot 3.2
- ORM: MyBatis-Plus 3.5
- 数据库: MySQL 8.0
- 缓存: Redis 7
- API 文档: OpenAPI 3.0 (SpringDoc)

### 前端 (frontend-web / frontend-h5)
- Web 端: Vue 3 + TypeScript + Element Plus + Vite
- H5 端: Vue 3 + Vant 4 + Vite

---

## 命名规范

| 层级 | 规范 | 示例 |
| :--- | :--- | :--- |
| Controller | `{模块}Controller` | `RoomController` |
| Service | `{模块}Service` (接口) + `{模块}ServiceImpl` (实现) | `RoomService` / `RoomServiceImpl` |
| Repository | `{模块}Repository extends BaseMapper<{实体}>` | `RoomRepository` |
| DTO | `Create{实体}DTO` / `Update{实体}DTO` / `{实体}PageDTO` | `CreateRoomDTO` |
| VO | `{实体}VO` | `RoomVO` |
| 数据库表 | snake_case 复数 | `t_rooms` |
| API 路径 | `/api/v1/{模块}/{操作}` | `/api/v1/rooms/list` |

---

## 代码规范（AI 自动遵守）

<!-- spec-rule: exception-handler -->
- 统一异常: 所有 Controller 方法抛出 `BusinessException`
- 全局捕获: `@ControllerAdvice` 统一处理，返回 `{ code: Integer, message: String, data: T }`
- 禁止: 直接返回 null、不处理异常、catch 后吞掉
- 错误码: 4 位数字，按模块划分（10xx-会议室 / 20xx-预订）
<!-- /spec-rule -->

<!-- spec-rule: response-format -->
- 统一返回: `Result<T>` = `{ code: Integer, message: String, data: T }`
- 成功: `Result.success(data)` — code=200
- 业务失败: `Result.fail(code, message)` — code 按模块错误码
- 分页: `PageResult<T>` = `{ code, message, data: { records, total, page, size } }`
<!-- /spec-rule -->

<!-- spec-rule: orm -->
- ORM: MyBatis-Plus 3.5，禁止手写 SQL（除非复杂报表）
- Repository: `extends BaseMapper<Entity>`
- 逻辑删除: `@TableLogic`，查询自动过滤已删除记录
- 分页: `Page<Entity>` + `repository.selectPage()`
- 自动填充: `@TableField(fill = FieldFill.INSERT)` 用于 createTime
<!-- /spec-rule -->

<!-- spec-rule: validation -->
- 参数校验: Controller 层 `@Valid` + JSR-303
- DTO: `@NotBlank` / `@NotNull` / `@Size` / `@Pattern`
- 业务校验: Service 层 `BusinessException`（如会议室时间冲突）
- 校验失败: `MethodArgumentNotValidException` → 400 + 字段级错误详情
<!-- /spec-rule -->

<!-- spec-rule: git-branch -->
- 分支格式: `{YYYYMMDD}-{任务名}-{姓名缩写}`
- 示例: `260722-会议室管理-zs`
- 从 main 拉出，开发完合并回 main
<!-- /spec-rule -->

---

## 数据库命名

| 规范 | 示例 |
| :--- | :--- |
| 表名: `t_` 前缀 + 英文复数 | `t_rooms` / `t_bookings` |
| 主键: `id` bigint 自增 | |
| 时间: `create_time` / `update_time` datetime | |
| 软删除: `deleted` tinyint(1) default 0 | |
| 索引: `idx_` 前缀 + 字段名 | `idx_room_id` |

---

## 异常码体系

| 错误码 | 含义 | 场景 |
| :--- | :--- | :--- |
| 1001 | 会议室不存在 | 查询/编辑不存在的会议室 |
| 1002 | 会议室名称重复 | 新增时名称已存在 |
| 2001 | 预订时间冲突 | 同一会议室同时间段已被预订 |
| 2002 | 预订不存在 | 取消/修改不存在的预订 |
| 2003 | 不可预订过去时间 | 预订时间早于当前时间 |
| 4001 | 参数校验失败 | @Valid 校验不通过 |
| 5000 | 系统内部错误 | 未预期的运行时异常 |

---

## 变更履历

| 时间 | 变更内容 | 类型 | 版本 |
| :--- | :--- | :--- | :--- |
| 2026-07-22 | 初始创建 | 新增 | v1.0 |
