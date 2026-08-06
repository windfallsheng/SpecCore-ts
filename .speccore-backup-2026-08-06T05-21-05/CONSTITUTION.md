# 技术宪法

> 本项目遵循 SpecCore 框架规范

## 项目信息

> 多工程时填写各子工程。**对应需求端**用于 AI 分析时自动对标（一个工程可对应多个需求端）

| 工程 | 路径 | Git 仓库 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- | :--- | :--- |
| ts-cli | /Users/luzhaosheng/SmartDeveloper/DevWorkspace/AI/SpecCore-CLI/ts-cli | git@gitee.com:windfullsheng/spec-core-ts.git | main | — |

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
