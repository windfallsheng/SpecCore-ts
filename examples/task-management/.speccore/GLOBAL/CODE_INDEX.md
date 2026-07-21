# 全量代码索引

> 本文档是多工程代码路径映射。每个 Task 对应哪个工程、在什么目录下。
> Task 创建时，AI 根据此表自动确定代码生成路径。

---

## 工程 → 路径 映射

| 工程 | 路径 | 技术栈 |
| :--- | :--- | :--- |
| backend | src/main/java/com/example | Spring Boot 3.2 |
| frontend-web | src/frontend/web | Vue 3 + Element Plus |
| frontend-mini | src/frontend/mini | uni-app |

---

## Task → 工程 映射

| Task | 涉及工程 | 说明 |
| :--- | :--- | :--- |
| 订单管理 | backend + frontend-web | 后端 CRUD + Web 页面 |
| 用户认证 | backend + frontend-web + frontend-mini | 三端共用认证 |
| 数据报表 | backend + frontend-web | 后端查询 + Web 看板 |

> 📌 新增 Task 时，在此追加一行对应关系。
