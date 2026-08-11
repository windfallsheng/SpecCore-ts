# Task 目录结构设计

> 本文档定义 SpecCore 中开发任务（Task）的目录结构规范。
> 规范版本: v2.0
> 最后更新: 2026-08-11

---

## 设计目标

1. **阶段清晰** — 执行前、执行中、执行后三个阶段的文件物理隔离
2. **元信息集中** — 任务状态、类型、负责人等统一放在 `.meta/` 下
3. **AI 友好** — AI 执行时能按优先级加载文件，不迷失在 10+ 个文件中
4. **变更可追溯** — 独立的 CHANGELOG.md 记录需求变更历史
5. **平台隔离** — 前后端实现目录分离，支持多端并行开发

---

## 目录结构

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
│   ├── TASK.md                     ← 任务履历 + 产出物清单 + 依赖关系
│   ├── SCHEMA.md                   ← 数据库 Schema（可选）
│   └── CHANGELOG.md                ← 需求变更记录
│
├── 10-backend/                     ← 后端实现
│   ├── src/                        ← 源代码（execute 生成）
│   ├── tests/                      ← 测试代码
│   └── {service}/                  ← 多服务时按服务拆分
│       ├── src/
│       └── tests/
│
├── 20-frontend/                    ← 前端实现
│   └── {platform}/                 ← web / admin / h5 / miniapp
│       ├── src/                    ← 源代码
│       ├── tests/                  ← 测试代码
│       ├── README.md               ← 前端任务说明
│       ├── COMPONENT_TREE.md       ← 组件树
│       ├── ROUTES.md               ← 路由设计
│       ├── STATE.md                ← 状态管理
│       └── STYLE_GUIDE.md          ← 样式规范
│
├── 99-artifacts/                   ← 执行产出（执行后填充）
│   ├── TEST.md                     ← 测试大纲 / 测试报告
│   ├── REVIEW.md                   ← 代码审查清单
│   ├── DEPLOY.md                   ← 部署检查清单
│   ├── RISK.md                     ← 风险评估 + 回滚方案
│   ├── DEPS.md                     ← 依赖清单
│   ├── MONITOR.md                  ← 监控点
│   ├── ERROR_CODES.md              ← 错误码定义
│   ├── ADR.md                      ← 架构决策记录（可选）
│   └── CODE_REVIEW.md              ← 代码审查报告（可选）
│
└── .issues.md                      ← 问题追踪（预创建空文件）
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

### 2. 核心规格与执行产出分离

**之前的问题：**
- `backend/` 下同时放了 REQ.md（规格）和 TEST.md（产出）
- AI 执行时需要从 10+ 个文件中找核心输入

**现在的方案：**
- `00-specs/` 只放 AI 执行时**必须读取**的文件（REQ/TECH/TASK）
- `99-artifacts/` 放执行过程中或执行后**生成/填充**的文件
- AI 加载顺序：`00-specs/` → `_shared/` → `10-backend/src/` → `99-artifacts/`

### 3. 元信息集中化

**之前的问题：**
- `.task-type` 和 `.task-status` 散落在 Task 根目录
- 状态面板需要扫描多个文件

**现在的方案：**
- 统一放到 `.meta/` 目录
- 每个元信息一个文件，方便脚本读取
- 支持扩展（如 `.meta/priority`、`.meta/due-date`）

### 4. 需求变更可追溯

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
3. Task-001/00-specs/TASK.md        → 任务概览 + 产出物清单
4. Task-001/00-specs/REQ.md         → 需求 + 验收标准
5. Task-001/00-specs/TECH.md        → 技术方案 + 接口设计
6. Task-001/_shared/API_CONTRACT.yaml → API 契约
7. Task-001/00-specs/CHANGELOG.md   → 了解变更历史（如有）
8. Task-001/10-backend/src/         → 已有代码（续跑时）

【补充阅读（按需）】
- 99-artifacts/TEST.md      → 测试要求
- 99-artifacts/RISK.md      → 风险注意点
- 99-artifacts/DEPS.md      → 依赖约束
- 99-artifacts/ERROR_CODES.md → 错误码规范
```

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
| `src/commands/iteration/split.ts` | 任务拆分创建目录结构 |
| `src/commands/task/new.ts` | 手动创建任务目录结构 |
| `src/commands/execute.ts` | 执行任务时读取路径 |
| `src/commands/change.ts` | 需求变更时更新路径 |
| `src/commands/analyze.ts` | 分析时补全文档路径 |
| `src/core/state.ts` | 状态扫描读取路径 |
