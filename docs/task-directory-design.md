# Task 目录结构设计

> 本文档定义 SpecCore 中开发任务（Task）的目录结构规范。
> 规范版本: v3.0
> 最后更新: 2026-08-15

---

## 设计目标

1. **阶段清晰** — 执行前规格与执行后产出物理隔离
2. **三级嵌套** — 前后端大类 → 端/服务 → 子任务，子任务是真正执行单元
3. **元信息集中** — 任务状态、类型、负责人等统一放在 `.meta/` 下
4. **AI 友好** — AI 执行时能按优先级加载文件，不迷失在 10+ 个文件中
5. **变更可追溯** — 独立的 CHANGELOG.md 记录需求变更历史
6. **平台隔离** — 前后端实现目录分离，支持多端并行开发
7. **文件即记忆** — 执行状态持久化到文件，新会话可快速恢复全局视角

---

## 目录结构

### feature / bugfix / refactor 类型（完整三级嵌套）

```
Task-001-user-login/
├── .meta/                          ← 任务元信息（统一入口）
│   ├── type                        ← feature / bugfix / refactor
│   ├── status                      ← todo / in-progress / done / aborted / needs-rework
│   ├── owner                       ← 负责人
│   └── created-at                  ← 创建时间 (YYYY-MM-DD)
│
├── _shared/                        ← 跨平台共享契约
│   └── API_CONTRACT.yaml           ← API 契约（前后端共用）
│
├── 00-specs/                       ← 执行前核心规格
│   ├── REQ.md                      ← 需求描述 + 验收标准
│   ├── TECH.md                     ← 技术方案 + 接口设计
│   ├── CONTEXT.md                  ← 任务上下文（来源追溯）
│   ├── TASK.md                     ← 任务履历 + 产出物清单
│   ├── SCHEMA.md                   ← 数据库 Schema（可选）
│   └── CHANGELOG.md                ← 需求变更记录
│
├── 10-backend/                     ← 后端实现
│   └── {service}/                  ← 服务名（如 api）
│       └── {subtask}/              ← 子任务名（如 login-api）
│           ├── .meta/              ← 子任务元信息 + git-config
│           ├── TASK.md             ← 子任务追踪
│           ├── src/                ← 源代码
│           └── tests/              ← 测试代码
│
├── 20-frontend/                    ← 前端实现
│   └── {platform}/                 ← 端名（h5/web/admin/miniapp）
│       └── {subtask}/              ← 子任务名（如 login-page）
│           ├── .meta/              ← 子任务元信息 + git-config
│           ├── TASK.md             ← 子任务追踪
│           ├── src/                ← 源代码
│           ├── tests/              ← 测试代码
│           ├── COMPONENT_TREE.md   ← 组件树
│           ├── ROUTES.md           ← 路由设计
│           ├── STATE.md            ← 状态管理
│           └── STYLE_GUIDE.md      ← 样式规范
│
└── .issues.md                      ← 问题追踪
```

> **子任务命名规则**：`slugify(需求章节名)`，如“登录接口” → `login-api`
> 无数字前缀，因为在 `10-backend/api/` 下已按服务归类。

### research 类型（无平台分层）

```
Task-002-investigate-auth/
├── .meta/
├── 00-specs/
│   ├── REQ.md
│   └── CONTEXT.md
├── RESEARCH.md                     ← 调研报告
└── COMPARISON.md                   ← 对比分析
```

---

## 设计原则

### 1. 编号分层语义

| 前缀 | 含义 | 阶段 |
|:---|:---|:---|
| `00-` | 规格文档 | 执行前 |
| `10-` | 后端实现 | 执行中 |
| `20-` | 前端实现 | 执行中 |
| `99-` | 执行产出 | 执行后 |

编号排序确保目录按开发流程自然排列。

### 2. 三级嵌套 + 子任务即执行单元

**核心设计：**
- `10-backend/{service}/{subtask}/` — 后端子任务
- `20-frontend/{platform}/{subtask}/` — 前端子任务
- 每个子任务有独立的 `.meta/` + `git-config` + `src/` + `tests/`
- 子任务是 AI 代码生成的真正目标单元

**为什么不用 `99-artifacts/`：**
- 旧结构把 TEST.md/REVIEW.md 等放在任务根的 `99-artifacts/`
- 新结构把这些产出放在每个子任务目录下，与代码紧邻
- 质量门禁扫描所有子任务目录下的产出文件

### 3. 核心规格与子任务产出分离

**现在的方案：**
- `00-specs/` 只放 AI 执行时**必须读取**的文件（REQ/TECH/TASK/CONTEXT）
- 子任务目录下的 `src/`/`tests/` 是 AI 输出代码的位置
- `_shared/` 只放跨平台共享契约（API_CONTRACT.yaml）
- AI 加载顺序：`00-specs/` → `_shared/` → `10-backend/{service}/{subtask}/` → `20-frontend/{platform}/{subtask}/`

### 4. 元信息集中化

**之前的问题：**
- `.task-type` 和 `.task-status` 散落在 Task 根目录
- 状态面板需要扫描多个文件

**现在的方案：**
- 统一放到 `.meta/` 目录
- 每个元信息一个文件，方便脚本读取
- 支持扩展（如 `.meta/priority`、`.meta/due-date`）

### 5. 需求变更可追溯

**之前的问题：**
- change 命令在 REQ.md 末尾追加变更记录
- 变更历史散落在各个文件末尾，难以汇总

**现在的方案：**
- 独立的 `00-specs/CHANGELOG.md`
- 格式统一：`时间 | 版本 | 变更内容 | 变更人`
- 支持迭代级 CHANGELOG 汇总

---

## AI 文件加载顺序

当 AI 执行开发任务时，按以下顺序加载文件：

```
1. Task-001/.meta/type              → 了解任务类型
2. Task-001/.meta/status            → 了解当前状态
3. Task-001/00-specs/CONTEXT.md     → 任务上下文 + 来源追溯
4. Task-001/00-specs/TASK.md        → 任务概览 + 产出物清单
5. Task-001/00-specs/REQ.md         → 需求 + 验收标准
6. Task-001/00-specs/TECH.md        → 技术方案 + 接口设计
7. Task-001/_shared/API_CONTRACT.yaml → API 契约
8. Task-001/00-specs/CHANGELOG.md   → 了解变更历史（如有）
9. Task-001/10-backend/{service}/{subtask}/src/  → 已有代码（续跑时）

【补充阅读（按需）】
- 子任务目录/TEST.md      → 测试要求
- 子任务目录/RISK.md      → 风险注意点
- 子任务目录/DEPS.md      → 依赖约束
```

---

## 文件即记忆架构

> v6.29.0 新增，解决全自动模式下上下文溢出问题。

### 问题背景

全自动执行时，每个任务注入 ~12K tokens 输入 + 生成 ~10K tokens 代码 = ~25K/任务。
6-7 个任务后累积 ~150K tokens，超出 128K 上下文窗口。

### 两层解决方案

```
任务完成 → addTaskSummary() 写入摘要到 execution-state.json
批次结束 → writeContextSummaryFile() 生成 ~1K tokens 摘要文件
         → 输出 [SPECCORE_CONTINUE: <path>] 标记
         
新会话启动 → 读取摘要文件（~1K tokens）→ 恢复全局视角 → 继续执行
```

**第一层：文件即记忆**
- 每个任务完成后，CLI 自动将进度、产出摘要、依赖关系写入 `.speccore/local/execution-state.json`
- 批次结束时，生成紧凑的 `execution-summary.md`（~1K tokens）
- 新会话只需读取这个文件就能恢复全局视角

**第二层：自动续批**
- 批次完成时输出 `[SPECCORE_CONTINUE: <path>]` 标记
- 宿主 AI 识别后引导用户开新会话，自动读取摘要继续

### 适用模式

| 模式 | 需要自动续批？ | 原因 |
|:--|:--|:--|
| 全自动 | 需要 | 无人值守，必须自动处理上下文切换 |
| 半自动 | 可选 | execute 前已有暂停点 |
| 全程确认 | 不需要 | 每步都有确认，用户自己控制节奏 |

---

## 需求变更流程

### 任务级变更

```bash
# 1. 记录变更
speccore change "把手机号改成支持国际号码" -t Task-001

# 自动完成：
# - 更新 00-specs/REQ.md（追加变更记录）
# - 更新 00-specs/CHANGELOG.md（新增变更条目）
# - 更新 00-specs/TASK.md（变更履历）
# - 如状态为 done，回退为 needs-rework
# - 事务保护（失败回滚）
```

### 迭代级新增需求

```bash
# 1. 补充需求到 features/
echo "## 新增: 批量导出" >> Iteration-Q1/010-requirements/features/order-management/README.md

# 2. 更新索引
speccore doc2spec -f new-prd.docx -i Q1

# 3. 重新分析
speccore analyze -I Q1

# 4. 增量拆分
speccore iteration split -i Q1
```

### 迭代级需求变更

```bash
# 1. 修改 converted/ 或 features/ 下的需求文档
# 2. 记录变更到 Iteration-Q1/010-requirements/CHANGELOG.md
# 3. 重新分析受影响范围
speccore analyze -I Q1 --scope changed

# 4. 标记受影响任务
speccore change --impact-analysis -i Q1
```

---

## 状态流转

```
todo → in-progress → done
  ↑                    |
  └──── needs-rework ←─┘
         ↑
         └─ change 命令触发（从 done 回退）
```

| 状态 | 含义 | 触发条件 |
|:---|:---|:---|
| `todo` | 待开发 | split / task new 创建时 |
| `in-progress` | 进行中 | execute 开始执行时 |
| `done` | 已完成 | execute 验证通过 + pr + done |
| `needs-rework` | 需返工 | change 命令修改已完成的任务 |
| `aborted` | 已终止 | 手动标记或执行失败放弃 |

---

## 迁移说明

### 从旧结构迁移

旧结构的 Task 目录：
```
Task-001/
├── .task-type
├── .task-status
├── _shared/
├── backend/          ← 混合了 specs + artifacts + code
└── frontend/
```

迁移到新结构：
```bash
# 1. 创建新目录
mkdir -p .meta 00-specs 10-backend/src 10-backend/tests 99-artifacts

# 2. 移动核心规格
mv backend/REQ.md 00-specs/
mv backend/TECH.md 00-specs/
mv backend/TASK.md 00-specs/

# 3. 移动执行产出
mv backend/TEST.md 99-artifacts/
mv backend/REVIEW.md 99-artifacts/
mv backend/DEPLOY.md 99-artifacts/
mv backend/RISK.md 99-artifacts/
mv backend/DEPS.md 99-artifacts/
mv backend/MONITOR.md 99-artifacts/
mv backend/ERROR_CODES.md 99-artifacts/

# 4. 移动代码
mv backend/*.java 10-backend/src/ 2>/dev/null || true

# 5. 迁移元信息
mv .task-type .meta/type
mv .task-status .meta/status

# 6. 创建 CHANGELOG.md
echo "# 变更记录" > 00-specs/CHANGELOG.md
```

---

## 相关文件

| 文件 | 说明 |
|:---|:---|
| `src/commands/iteration/split.ts` | 任务拆分，创建三级嵌套目录结构 |
| `src/commands/task/new.ts` | 手动创建任务，适配三级嵌套 |
| `src/commands/execute.ts` | 执行任务，扫描子任务目录，批次摘要 |
| `src/core/execution-state.ts` | 执行状态追踪 + 文件即记忆 |
| `src/core/rag-engine.ts` | RAG 索引，动态扫描子任务文档 |
| `src/core/knowledge-graph.ts` | 知识图谱，适配三级嵌套扫描 |
| `src/core/prompt-builder.ts` | Prompt 构建，动态加载子任务文件 |
| `src/core/spec-merger.ts` | 局部更新引擎，00-specs/ 优先 |
| `src/commands/analyze.ts` | 分析时补全文档到子任务目录 |
| `src/commands/status-panel.ts` | 状态面板，适配新目录名 |
| `src/commands/context-output.ts` | 上下文输出，00-specs/ 优先 |
