## 📂 项目结构

```
meeting-system/
├── docs/                            ← 原始需求文档（4 份）
├── prototype-admin.html             ← Web 后台原型
├── prototype-h5.html                ← H5 移动端原型
│
├── .speccore/                       ← speccore init 生成
│   ├── CONSTITUTION.md              ← 全局技术宪法（7 条规则）
│   ├── GLOBAL/INDEX.md              ← 全量需求索引
│   ├── GLOBAL/CODE_INDEX.md         ← 工程 → 代码路径映射
│   ├── PROJECT/TEAM.md              ← 团队成员
│   └── config/platforms.yaml        ← 平台配置（backend, web, h5）
│
└── 期次-Q1/                         ← speccore word2spec 生成
    ├── 00-需求文档/                  ← 结构化需求 + 分析报告
    │   ├── REQUIREMENT.md           ← Q1 需求汇总
    │   ├── backend需求.md           ← 2 份后端需求合并
    │   ├── frontend-web需求.md      ← 后台管理端需求
    │   ├── frontend-h5需求.md       ← 移动端需求
    │   └── ANALYSIS.md              ← speccore analyze 生成
    │
    ├── Task-001-会议室管理/          ← 前后端一体化 Task
    │   ├── .task-type
    │   ├── TASK.md                   ← 总览: 后端 5AC + 前端 3AC
    │   ├── backend/
    │   │   └── room-service/         ← 后端服务 ①: 会议室管理
    │   │       ├── TASK.md           ← BDD AC · 技术决策 · 踩坑记录
    │   │       ├── API_CONTRACT.yaml ← OpenAPI 3.0 契约
    │   │       ├── TEST.md           ← 测试大纲（14 用例）
    │   │       ├── REVIEW.md         ← 代码审查清单
    │   │       ├── SCHEMA.md         ← Flyway SQL + 索引说明
    │   │       ├── DEPLOY.md         ← 部署检查清单
    │   │       └── ERROR_CODES.md    ← 错误码定义
    │   └── frontend/
    │       └── web/                  ← 前端: Web 管理端
    │           └── TASK.md           ← 页面架构 + 组件选型
    │
    └── Task-002-预订管理/            ← 前后端 + 双前端 Task
        ├── .task-type
        ├── TASK.md                   ← 总览: 后端 5AC + Web 2AC + H5 3AC
        ├── backend/
        │   └── booking-service/      ← 后端服务 ②: 预订订单
        │       ├── TASK.md           ← 冲突检测 · 并发防护 · 防抖
        │       ├── API_CONTRACT.yaml ← OpenAPI 3.0 契约
        │       ├── TEST.md           ← 测试大纲（16 用例 + 并发）
        │       ├── REVIEW.md         ← 代码审查清单
        │       ├── SCHEMA.md         ← Flyway SQL + 联合唯一索引
        │       ├── DEPLOY.md         ← 部署检查清单
        │       └── ERROR_CODES.md    ← 错误码定义
        └── frontend/
            ├── web/                  ← 前端: Web 预订管理
            │   └── TASK.md
            └── h5/                   ← 前端: H5 移动端预订
                └── TASK.md           ← Vant4 组件 · 实时冲突检测

目录规则: Task/{backend/{服务名}/, frontend/{平台}/}
```

---

## 📋 Task 概览

| Task | 后端服务 | 前端 | 来源需求 | AC |
| :--- | :--- | :--- | :--- | :--- |
| Task-001 会议室管理 | room-service | web | 会议室管理服务 + 后台管理端 | 8 |
| Task-002 预订管理 | booking-service | web + h5 | 预订订单服务 + 后台管理端 + H5 移动端 | 10 |

---

## ✨ 设计亮点

| 亮点 | 说明 |
| :--- | :--- |
| **前后端一体化** | 同一功能的后端+前端在一个 Task，按 `backend/{服务名}/` `frontend/{平台}/` 分层 |
| **后端按服务细分** | 多个后端服务各自独立目录（当前各 Task 一个服务，可扩展为多个） |
| **前端按平台细分** | web / h5 / miniapp 各自独立，可共用 API 封装 |
| **真实工具链流程** | `init → word2spec → analyze → split → execute` 完整走通 |
| **7 类 Spec 文件** | TASK + API + TEST + REVIEW + SCHEMA + DEPLOY + ERROR_CODES |
| **踩坑记录** | 每个 Task 记录实际开发经验，AI 下次读取自动避开 |
