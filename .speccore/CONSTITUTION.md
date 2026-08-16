# 技术宪法

> 本文档是 SpecCore 与 AI 的**最高优先级契约**。analyze/split/execute 均据此执行。
> AI 读取顺序：CONSTITUTION → context.json → 迭代目录

## 端列表（全局权威）

> ⚠️ **端名是全项目唯一的标识符**，所有命令（analyze/split/execute）、目录名（020-specs/{端}/）、模板目录（templates/{level}/{端}/）均使用此处声明的端名。

| 工程标识 | 描述 | 类型 |
| :--- | :--- | :--- |
| app | 移动端 APP | frontend |
| h5 | 移动 H5 端 | frontend |
| miniapp | 小程序端 | frontend |
| admin | 后台管理端 | frontend |

> **端名规则**：
> - 端名 = 工程名，一一对应
> - 全小写、无空格、用短横线分隔（如 order-service）
> - 类型：frontend / backend / infra
> - 此列表是 analyze/split/execute 的唯一端名来源
> - 「对应端」列引用此列表中的端名，每行只填一个

## 项目信息

> ⚠️ **所有端名称（app/h5/miniapp/admin）必须与 010-requirements/ 子目录名严格一致**

| 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ts-cli | SpecCore CLI | ./ | git@gitee.com:windfullsheng/spec-core-ts.git | main | 待填写 |

> 多工程示例（每个端 = 一个独立工程）:
>
> | 工程 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |
> | :--- | :--- | :--- | :--- | :--- |
> | admin-web | ./packages/admin | git@xxx/admin.git | main | admin |
> | h5-app | ./packages/h5 | git@xxx/h5.git | main | h5 |
> | backend-service | ./packages/backend | git@xxx/backend.git | main | backend |
>
> **关键规则**：
> - 「对应端」列的值必须引用「端列表」中已声明的端名
> - 一一对应：每行一个工程对应一个端名（不填多个）
> - 如果一个服务拆成多个工程（如 user-service + order-service 都属于 backend），应在「端列表」中分别声明

## 技术栈

### 后端
- 语言：Java / TypeScript / Go / Python
- 框架：Spring Boot / NestJS / Gin / FastAPI
- 数据库：MySQL / PostgreSQL / MongoDB
- 缓存：Redis

### 前端
- 框架：Vue / React / Angular
- 状态管理：Pinia / Redux / NgRx
- UI 组件：Element Plus / Ant Design

## 命名规范
- 接口：/api/v1/{模块}/{操作}
- 错误码：4 位数字，按模块划分
- 数据库：snake_case
- 代码：camelCase / PascalCase

## 异常码体系
| 错误码 | 含义 | 场景 |
| :--- | :--- | :--- |
| 1001 | 用户不存在 | 登录时手机号未注册 |
| 1002 | 密码错误 | 登录密码不匹配 |
| ... | ... | ... |

## Git 分支策略
- 默认分支: main  (可选: master / develop / trunk / release)
- 任务分支: feature/{Task-ID}
- 发布分支: release/{version}
- 保护分支: main, master, release/*, production
  > 保护分支上禁止直接 commit 和 push，只能通过 PR 合并
  > 支持精确匹配和通配符（如 release/*）
