# 项目代码复用索引 (Code Reuse Index)

> **文档定位**：维护项目所有可复用组件的能力映射表。当开发新 Feature 时，AI 应优先查阅本索引，避免重复造轮子。  
> **维护规则**：每完成一个 Feature，检查是否有可复用的通用组件，追加到本表。

---

## 基础能力

| 能力域 | 组件 | 位置 | 用途 | 首次沉淀 |
| :--- | :--- | :--- | :--- | :--- |
| 全局异常处理 | `GlobalExceptionHandler` | `src/main/java/com/xxx/advice/GlobalExceptionHandler.java` | 统一错误码映射、HTTP 状态码转换 | Feature-001 |
| 统一响应体 | `ApiResponse<T>` | `src/main/java/com/xxx/common/ApiResponse.java` | 统一 `{code, message, data}` 格式 | Feature-001 |
| 分页工具 | `PageUtils` | `src/main/java/com/xxx/util/PageUtils.java` | MyBatis-Plus 分页封装 | Feature-001 |

## 安全与认证

| 能力域 | 组件 | 位置 | 用途 | 首次沉淀 |
| :--- | :--- | :--- | :--- | :--- |
| JWT 工具 | `JwtUtils` | `src/main/java/com/xxx/util/JwtUtils.java` | Token 生成、解析、校验 | Feature-001 |
| 认证拦截器 | `AuthInterceptor` | `src/main/java/com/xxx/interceptor/AuthInterceptor.java` | 请求 Token 校验 | Feature-001 |
| BCrypt 加密 | Spring Security | 依赖注入 `BCryptPasswordEncoder` | 密码加密与比对 | Feature-001 |
| 防暴力破解 | `LoginAttemptService` | `src/main/java/com/xxx/service/LoginAttemptService.java` | 登录失败计数与锁定 | Feature-001 |
| 权限注解 | `@PreAuthorize` | Spring Security 注解 | 接口级角色控制 | Feature-001 |

## 数据与缓存

| 能力域 | 组件 | 位置 | 用途 | 首次沉淀 |
| :--- | :--- | :--- | :--- | :--- |
| Redis 操作 | `RedisTemplate` | Spring Data Redis 注入 | 缓存读写、过期控制 | Feature-001 |
| 分布式锁 | `RedisLock` | `src/main/java/com/xxx/util/RedisLock.java` | 防重复提交、防并发冲突 | Feature-002 |
| 数据脱敏 | `DataMaskUtils` | `src/main/java/com/xxx/util/DataMaskUtils.java` | 手机号/身份证脱敏 | Feature-003 |
| 文件导出 | `ReportExporter` | `src/main/java/com/xxx/util/ReportExporter.java` | PDF/Excel/CSV 生成 | Feature-002 |

## 消息与通知

| 能力域 | 组件 | 位置 | 用途 | 首次沉淀 |
| :--- | :--- | :--- | :--- | :--- |
| 消息通知 | `NotificationService` | `src/main/java/com/xxx/service/NotificationService.java` | 邮件、短信、站内信发送 | Feature-002 |
| 异步任务 | `ThreadPoolConfig` | `src/main/java/com/xxx/config/ThreadPoolConfig.java` | 异步处理线程池 | Feature-002 |

## 权限管理

| 能力域 | 组件 | 位置 | 用途 | 首次沉淀 |
| :--- | :--- | :--- | :--- | :--- |
| RBAC 服务 | `RoleService` | `src/main/java/com/xxx/service/RoleService.java` | 角色 CRUD + 用户分配 | Feature-004 |
| 权限树服务 | `PermissionService` | `src/main/java/com/xxx/service/PermissionService.java` | 权限树查询与构建 | Feature-004 |
| 角色校验 | `RoleValidator` | `src/main/java/com/xxx/validator/RoleValidator.java` | 系统保护角色检查 | Feature-004 |

## 前端公共组件

| 能力域 | 组件 | 位置 | 用途 | 首次沉淀 |
| :--- | :--- | :--- | :--- | :--- |
| HTTP 请求封装 | `request.ts` | `src/utils/request.ts` | Axios 拦截器（Token 注入、错误处理） | Feature-001 |
| 权限指令 | `v-permission` | `src/directives/permission.ts` | 按钮级权限显隐控制 | Feature-001 |
| 金额格式化 | `formatCurrency` | `src/utils/format.ts` | ¥ 格式化（千分位 + 两位小数） | Feature-002 |
| 图表组件 | `PieChart.vue` | `src/components/charts/PieChart.vue` | ECharts 饼图封装 | Feature-002 |
| 权限树组件 | `PermissionTree.vue` | `src/components/permission/PermissionTree.vue` | el-tree 权限勾选封装 | Feature-004 |
| 用户穿梭框 | `UserTransfer.vue` | `src/components/user/UserTransfer.vue` | el-transfer 用户分配封装 | Feature-004 |

---

## 使用方式

在 `TASK.md` 的「技术参考与上下文」区块中，按以下格式引用本索引：

```markdown
### 复用项目现有代码
- [ ] `../../../.ai/PATTERNS/reference-index.md` —— 按需选用项目已有能力
- [ ] `src/main/java/com/xxx/util/RedisLock.java` —— 分布式锁（防止重复提交）
```

---

| 版本 | 日期 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| v1.0 | 2026-06-29 | 初始创建，纳入 Feature-001~004 沉淀组件 | 架构师 |
