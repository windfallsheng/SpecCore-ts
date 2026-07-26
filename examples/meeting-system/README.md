# 会议预订系统 — SpecCore 完整示例

> 🔗 [原始 PRD 文档](PRD/PRD.md) | 📐 [HTML 原型预览](PRD/prototype-admin.html)

这是一个基于 **SpecCore 框架** 构建的企业级会议预订系统的完整示例项目。展示了从需求文档到 Spec 文件、再到 AI 可执行的原子任务的完整流程。

---

## 项目结构

```
meeting-system/
├── PRD/                              ← 原始需求文档 + 原型
├── .speccore/                        ← SpecCore 框架配置
│   ├── CONSTITUTION.md               ← 全局技术宪法
│   ├── GLOBAL/                       ← 全量需求索引 & 架构
│   ├── PATTERNS/                     ← 可复用模式库
│   └── PROJECT/TEAM.md               ← 团队成员
└── 期次-Q1/                          ← 迭代周期
    ├── 00-需求文档/REQUIREMENT.md     ← 迭代需求汇总
    ├── Task-001-会议室管理服务/       ← 后端 Task
    │   └── backend/
    │       ├── TASK.md                ← 任务清单 + 踩坑记录
    │       └── API_CONTRACT.yaml      ← OpenAPI 3.0 接口契约
    ├── Task-002-预订订单服务/         ← 后端 Task
    ├── Task-003-后台管理端/           ← Web 前端 Task
    └── Task-004-H5移动端/            ← H5 前端 Task
```

---

## 从零开始的 5 分钟体验

```bash
# 1. 初始化
cd meeting-system
speccore init

# 2. 导入需求（从 PRD 文档）
speccore word2spec --files "PRD/docs/需求-会议室管理服务.md=backend" -i Q1

# 3. 分析需求 + 检查宪法合规
speccore analyze --iteration=Q1

# 4. 拆分为独立 Task
speccore split --iteration=Q1

# 5. 执行开发（AI 读取 Spec 后生成代码）
speccore execute --task=Task-001 --force --iteration=Q1

# 6. 提交 PR
speccore pr --task=Task-001

# 7. 完成任务
speccore done --task=Task-001
```

> 💡 也可以只敲 `speccore`，自适应面板会逐步引导。

---

## 设计亮点

| 亮点 | 实现 |
| :--- | :--- |
| **前后端分离** | 4 个 Task，2 后端 + 2 前端，通过 API_CONTRACT.yaml 锚定契约 |
| **原子任务自包含** | 每个 Task 目录包含 TASK.md + API_CONTRACT.yaml，AI 一次加载 |
| **模式沉淀** | PATTERNS/ 记录了时间冲突检测、缓存一致性等 3 个可复用模式 |
| **踩坑记录** | 每个 TASK.md 末尾记录实际开发中的坑，后续 AI 自动避开 |
| **多平台** | backend + frontend-web + frontend-h5，配置文件在 `config/platforms.yaml` |

---

## 四个 Task 概览

| Task | 平台 | 核心功能 | AC 数 |
| :--- | :--- | :--- | :--- |
| Task-001 | backend | 会议室 CRUD + 分页筛选 | 7 |
| Task-002 | backend | 预订创建/取消 + 冲突检测 | 6 |
| Task-003 | frontend-web | Element Plus 管理界面 | 5 |
| Task-004 | frontend-h5 | Vant4 移动端预订 | 5 |
