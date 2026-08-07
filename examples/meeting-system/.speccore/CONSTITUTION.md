# 技术宪法

> 本项目遵循 SpecCore 框架规范

## 项目信息

> 多工程时填写各子工程的路径和仓库

| 工程 | 项目名称 | 路径 | Git 仓库 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 后端服务 | 会议室管理后端 | /workspace/backend | git@xxx:backend.git | main | APP端, 管理后台 |
| 前端H5 | 会议室预订H5 | /workspace/frontend | git@xxx:frontend.git | main | H5端 |
| 小程序 | 会议室预订小程序 | /workspace/miniapp | git@xxx:miniapp.git | main | 小程序端 |

## 技术栈
### 后端
- 语言：Java
- 框架：Spring Boot 3.x
- 数据库：MySQL 8.0
- 缓存：Redis 7

### 前端
- 框架：Vue 3 + TypeScript
- UI 组件：Element Plus
- 小程序：uni-app

## Git 分支策略
- 默认分支: main
- 任务分支: feature/{Task-ID}
- 发布分支: release/{version}
