# 全量代码索引

> 本文档是工程 → 代码路径 + Git 仓库映射。Task 创建时，AI 根据此表确定代码生成目录和 Git 分支。

---

## 工程 → 路径 + Git 映射

| 工程 | 代码路径 | Git 仓库 | 默认分支 | 技术栈 |
| :--- | :--- | :--- | :--- | :--- |
| backend | src/main/java/com/example | git@github.com:team/task-api.git | main | Spring Boot |
| frontend-web | src/frontend/web | git@github.com:team/task-web.git | main | Vue 3 |
| frontend-mini | src/frontend/mini | git@github.com:team/task-mini.git | main | uni-app |

## 分支命名规则

格式: `{YYYYMMDD}-{任务名}-{姓名缩写}`，从 `{默认分支}` 拉出。
示例: `260715-订单管理-zs`（从 main 拉出）

> 姓名缩写参见 PROJECT/TEAM.md。AI 在 Task 关联多个工程时，为每个工程创建同名分支。

## Task → 工程 映射

| Task | 涉及工程 | 说明 |
| :--- | :--- | :--- |
| 订单管理 | backend + frontend-web | 后端 CRUD + Web 页面 |
| 用户认证 | backend + frontend-web + frontend-mini | 三端共用认证 |
| 数据报表 | backend + frontend-web | 后端查询 + Web 看板 |

> 📌 新增 Task/工程时，在此追加对应行。
