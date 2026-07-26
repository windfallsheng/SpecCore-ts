# 会议预订系统 — SpecCore 完整示例

> 🔗 [原始 PRD](docs/PRD-会议室预订系统v1.0.md) | 📐 [后台原型](prototype-admin.html) | 📱 [H5 原型](prototype-h5.html)

这是一个基于 **SpecCore 框架** 的完整示例——从 4 份需求文档开始，经过 `word2spec` → `analyze` → `split`，最终产出 4 个 AI 可执行的原子 Task。

---

## 🚀 真实流程（照着做一遍）

### 第一步：项目初始化

```bash
cd meeting-system
speccore init
```

产出 `.speccore/`（宪法 + 全局层 + 团队配置 + Slash Commands）

### 第二步：编辑宪法，设定项目规范

编辑 `.speccore/CONSTITUTION.md`，填入：

- 技术栈（Java 17 + Spring Boot 3.2 + Vue 3）
- 命名规范（Controller/Service/Repository/DTO）
- 代码规则（7 条 `spec-rule`）
- 错误码体系（10xx 会议室 / 20xx 预订）

> 📖 参见 [.speccore/CONSTITUTION.md](.speccore/CONSTITUTION.md)

### 第三步：导入 4 份需求文档（2 后端 + 2 前端）

```bash
speccore word2spec \
  --files "docs/需求-会议室管理服务.md=backend, \
           docs/需求-预订订单服务.md=backend, \
           docs/需求-后台管理端.md=frontend-web, \
           docs/需求-H5移动端.md=frontend-h5" \
  -i Q1
```

框架自动将 4 份原始需求结构化为 Spec 格式：
- `期次-Q1/00-需求文档/backend需求.md`
- `期次-Q1/00-需求文档/frontend-web需求.md`
- `期次-Q1/00-需求文档/frontend-h5需求.md`

### 第四步：需求分析

```bash
speccore analyze --iteration=Q1
```

检查：宪法合规性、需求完整性、接口定义覆盖率。

### 第五步：拆分为原子 Task

```bash
speccore split --iteration=Q1
```

框架根据需求结构自动拆分为 4 个 Task：
- `Task-001-会议室管理` (backend)
- `Task-002-预订订单` (backend)
- `Task-003-后台管理端` (frontend-web)
- `Task-004-H5移动端` (frontend-h5)

### 第六步：补充 Task 细节

`split` 生成了任务骨架，接下来手动补全：

- 每个 Task 的 `TASK.md` — 验收标准（AC）+ 踩坑记录
- 每个后端 Task 的 `API_CONTRACT.yaml` — OpenAPI 3.0 接口契约

> 📖 这些文件已在本示例中补全，参见各 Task 目录。

### 第七步：执行开发

```bash
speccore execute --task=Task-001 --force --iteration=Q1
speccore pr --task=Task-001
speccore done --task=Task-001
```

---

## 📂 产出结构

```
meeting-system/
├── docs/                           ← 原始需求（4 份）
│   ├── 需求-会议室管理服务.md
│   ├── 需求-预订订单服务.md
│   ├── 需求-后台管理端.md
│   └── 需求-H5移动端.md
├── prototype-admin.html            ← 后台原型
├── prototype-h5.html               ← H5 原型
│
├── .speccore/                      ← speccore init 生成
│   ├── CONSTITUTION.md             ← 全局技术宪法
│   ├── GLOBAL/INDEX.md             ← 全量需求索引
│   ├── GLOBAL/CODE_INDEX.md        ← 工程 → 代码路径映射
│   ├── PROJECT/TEAM.md             ← 团队成员
│   └── config/platforms.yaml       ← 平台配置
│
└── 期次-Q1/                        ← speccore word2spec 生成
    ├── 00-需求文档/                 ← 结构化需求
    │   ├── REQUIREMENT.md          ← 迭代需求汇总
    │   ├── backend需求.md          ← 2 份后端需求合并
    │   ├── frontend-web需求.md
    │   └── frontend-h5需求.md
    │
    ├── Task-001-会议室管理服务/     ← speccore split 生成
    │   └── backend/
    │       ├── TASK.md             ← 任务清单 + AC + 踩坑记录
    │       └── API_CONTRACT.yaml   ← OpenAPI 3.0 接口契约
    ├── Task-002-预订订单服务/
    │   └── backend/
    ├── Task-003-后台管理端/
    │   └── frontend-web/
    └── Task-004-H5移动端/
        └── frontend-h5/
```

---

## 📋 4 个 Task 概览

| Task | 平台 | 核心功能 | 来源需求 | AC 数 | 文件 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Task-001 | backend | 会议室 CRUD | 会议室管理服务 | 7 | [TASK](期次-Q1/Task-001-会议室管理服务/backend/TASK.md) · [API](期次-Q1/Task-001-会议室管理服务/backend/API_CONTRACT.yaml) |
| Task-002 | backend | 预订 + 冲突检测 | 预订订单服务 | 6 | [TASK](期次-Q1/Task-002-预订订单服务/backend/TASK.md) · [API](期次-Q1/Task-002-预订订单服务/backend/API_CONTRACT.yaml) |
| Task-003 | frontend-web | 管理界面 | 后台管理端 | 5 | [TASK](期次-Q1/Task-003-后台管理端/frontend-web/TASK.md) |
| Task-004 | frontend-h5 | 移动端预订 | H5 移动端 | 5 | [TASK](期次-Q1/Task-004-H5移动端/frontend-h5/TASK.md) |

---

## ✨ 设计亮点

| 亮点 | 说明 |
| :--- | :--- |
| **真实框架流程** | 从 `init` → `word2spec` → `analyze` → `split` 完整走一遍，不是手写 |
| **2 后端 + 2 前端** | 后端需求自动合并，前端/后端各有来源文档 |
| **OpenAPI 契约** | 前后端通过 API_CONTRACT.yaml 锚定接口，并行开发不打架 |
| **踩坑记录** | 每个 TASK.md 有实际开发经验，AI 下次读取可自动避开 |
| **多平台** | backend + frontend-web + frontend-h5，平台定义在 `platforms.yaml` |
