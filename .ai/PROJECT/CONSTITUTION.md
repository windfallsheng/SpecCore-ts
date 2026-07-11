# 项目全局宪法 (Global Constitution)

> **文档定位**：本文件是项目级的"最高法"，所有开发活动（AI 或人工）必须遵守。本宪法优先级高于任何口头约定和临时决策。

---

## 1. 技术栈强制规范

| 类别 | 技术选型 | 版本要求 |
| :--- | :--- | :--- |
| **后端框架** | Spring Boot | 3.2.5 |
| **JDK** | Java | 17 |
| **ORM** | MyBatis-Plus | 3.5.5 |
| **数据库** | MySQL | 8.0，字符集 utf8mb4 |
| **缓存** | Redis | 7.0 |
| **JWT** | jjwt-api | 0.11.5 |
| **前端框架** | Vue 3 + TypeScript + Vite | 最新稳定版 |
| **UI 组件库** | Element Plus | 最新稳定版 |

---

## 2. 命名铁律

### Java / 后端
- **类名**: 驼峰命名 (如 `UserController`, `AuthServiceImpl`)
- **方法名**: 小驼峰 (如 `findByPhone`, `generateToken`)
- **数据库表**: 小写 + 下划线 (如 `sys_user`, `sys_role`)
- **数据库字段**: 小写 + 下划线 (如 `created_at`, `updated_by`)
- **接口路径**: 复数名词，如 `/api/v1/users`, `/api/v1/auth/login`
- **包结构**: `com.{company}.{module}.{layer}` (如 `com.xxx.user.controller`)

### Vue / 前端
- **组件文件名**: PascalCase (如 `LoginView.vue`, `UserTable.vue`)
- **目录名**: kebab-case (如 `user-management`, `data-report`)
- **Store**: camelCase (如 `useUserStore`)
- **API 函数**: camelCase (如 `loginApi`, `getUserInfoApi`)

---

## 3. 异常码区间（全局统一）

| 区间 | 含义 | 示例 |
| :--- | :--- | :--- |
| 1000-1999 | 参数校验错误 | 1001 手机号格式错误 |
| 2000-2999 | 认证授权错误 | 2001 Token 过期 |
| 3000-3999 | 业务逻辑冲突 | 3001 用户已存在 |
| 5000-5999 | 系统内部错误 | 5001 Redis 不可用 |

---

## 4. 强制约束

- ✅ 所有后端接口必须包含 Swagger 注解 (`@Operation`)
- ✅ 所有写操作必须加 `@Transactional(rollbackFor = Exception.class)`
- ✅ 前端所有 API 调用必须有 `try-catch` 错误处理并展示用户可理解的提示
- ✅ 所有开发活动须遵守《代码与 Spec 冲突裁决规则》(见 `RULES/conflict-resolution.md`)
- ✅ **本宪法修改需经架构评审**，不得在开发中临时绕过

---

## 5. 环境变量约定

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `DB_HOST` | 数据库地址 | localhost |
| `DB_PORT` | 数据库端口 | 3306 |
| `REDIS_HOST` | Redis 地址 | localhost |
| `JWT_SECRET` | JWT 签名密钥 | 生产环境使用强随机字符串 |
| `JWT_EXPIRATION` | Token 过期时间(毫秒) | 7200000 |

---

| 版本 | 日期 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| v1.0 | 2026-06-29 | 初始创建 | 架构师 |
