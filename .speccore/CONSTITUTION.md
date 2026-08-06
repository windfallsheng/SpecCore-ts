# 技术宪法

> 本文档是 SpecCore 与 AI 的**最高优先级契约**。analyze/split/execute 均据此执行。
> AI 读取顺序：CONSTITUTION → context.json → 迭代目录

## 项目信息

> ⚠️ **所有需求端名称（app/h5/miniapp/admin）必须与 010-requirements/ 子目录名严格一致**

| 工程 | 源码路径 | Git 仓库 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- | :--- | :--- |
| ts-cli | ./ | git@gitee.com:windfullsheng/spec-core-ts.git | main | app, h5, miniapp, admin |

> 多工程示例（monorepo）:
>
> | 工程 | 源码路径 | Git 仓库 | 默认分支 | 对应需求端 |
> | :--- | :--- | :--- | :--- | :--- |
> | order-service | ./packages/order | git@xxx/order.git | master | app, admin |
> | payment-service | ./packages/payment | git@xxx/pay.git | main | h5, miniapp |
>
> **关键规则**：「对应需求端」列的值决定了：
> 1. 读取哪个 010-requirements/{端}/ 的需求文档
> 2. 分析结果写入 020-specs/{端}/
> 3. split 时按端创建 Task 并过滤对应的 API

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
