# Task 目录结构设计

> 本文档定义 SpecCore 中开发任务（Task）的目录结构规范。
> 规范版本: v4.0
> 最后更新: 2026-08-16

---

## 设计目标

1. **阶段清晰** — 执行前规格与执行后产出物理隔离
2. **端平铺** — 所有端（后端服务/前端应用）平铺在任务目录下，不再区分前后端大类
3. **元信息集中** — 任务/子任务状态、类型、负责人、功能单元等统一放在 `.meta/` 下
4. **AI 友好** — AI 执行时能按优先级加载文件，不迷失在 10+ 个文件中
5. **变更可追溯** — 独立的 CHANGELOG.md 记录需求变更历史
6. **工程路径感知** — 代码写入 CONSTITUTION.md 指定的实际工程路径，而非迭代目录
7. **文件即记忆** — 执行状态持久化到文件，新会话可快速恢复全局视角

---

## 目录结构

### feature / bugfix / refactor 类型（端平铺架构）

```
Task-001-user-login/
├── .meta/                          ← 任务级元信息
│   ├── type                        ← feature / bugfix / refactor
│   ├── status                      ← todo / in-progress / done
│   ├── owner                       ← 负责人
│   ├── feature                     ← 功能单元名称（如"用户登录"）
│   ├── created-at                  ← 创建时间 (YYYY-MM-DD)
│   └── git-config                  ← Git 分支配置
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
├── booking-service/                ← 后端服务（平铺，无 10-backend/ 前缀）
│   └── Task-001-booking-order/     ← 子任务（{taskId}-{subtaskSlug}）
│       ├── .meta/                  ← 子任务元信息
│       │   ├── type                ← feature / bugfix / refactor
│       │   ├── status              ← todo / in-progress / done
│       │   ├── owner               ← 负责人
│       │   ├── feature             ← 功能单元名称
│       │   ├── created-at          ← 创建时间
│       │   └── git-config          ← Git 分支配置（继承任务级）
│       ├── TASK.md                 ← 子任务追踪
│       ├── TEST.md                 ← 测试大纲
│       ├── REVIEW.md               ← 评审清单
│       ├── DEPLOY.md               ← 部署清单
│       ├── ERROR_CODES.md          ← 错误码定义
│       ├── RISK.md                 ← 风险评估
│       ├── DEPS.md                 ← 依赖清单
│       ├── MONITOR.md              ← 监控方案
│       └── ADR.md                  ← 架构决策（如有）
│
├── h5-mobile/                      ← 前端应用（平铺，无 20-frontend/ 前缀）
│   └── Task-001-login-page/        ← 子任务
│       ├── .meta/                  ← 子任务元信息（同上）
│       ├── TASK.md                 ← 子任务追踪
│       ├── COMPONENT_TREE.md       ← 组件树
│       ├── ROUTES.md               ← 路由设计
│       ├── STATE.md                ← 状态管理
│       ├── STYLE_GUIDE.md          ← 样式规范
│       ├── TEST.md                 ← 测试大纲
│       └── REVIEW.md               ← 评审清单
│
└── .issues.md                      ← 问题追踪
```

> **子任务命名规则**：`{taskId}-{subtaskSlug}`，如 `Task-001-booking-order`
> 确保全项目唯一，不同任务的同名端不会冲突。

> **代码输出位置**：execute 命令读取 CONSTITUTION.md 中的「源码路径」列，
> 将代码写入实际工程目录（如 `../outputs-project/backend/booking-service/`），
> 而非子任务目录内。子任务目录只放文档，不放代码。

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

### 1. 端平铺架构（v6.49.1+）

**旧结构（已废弃）：**
```
Task-001/
├── 10-backend/          ← 类型前缀（冗余）
│   └── api/
│       └── impl/
├── 20-frontend/         ← 类型前缀（冗余）
│   └── h5/
│       └── impl/
```

**新结构（v6.49.1+）：**
```
Task-001/
├── booking-service/     ← 所有端平铺
│   └── Task-001-impl/
├── h5-mobile/           ← 所有端平铺
│   └── Task-001-impl/
```

**为什么去掉 10-backend/ 和 20-frontend/：**
- 后端服务名本身已暗示"后端"（如 `booking-service`）
- 减少一层嵌套，降低认知负担
- 支持任意数量的端，不受前后端二分法限制

### 2. 子任务即执行单元

**核心设计：**
- `{platform}/{taskId}-{subtaskSlug}/` — 所有端的子任务统一格式
- 每个子任务有独立的 `.meta/` + 文档（TEST.md/REVIEW.md 等）
- 代码写入 CONSTITUTION.md 指定的实际工程路径
- 子任务是 AI 代码生成的真正目标单元

### 3. 功能单元标识

**任务级和子任务级都有 `.meta/feature`：**
- 默认值：`section.functionalUnit || section.name || '未分类'`
- 用途：按功能模块统计任务数量和工时
- 可手动修改，后期调整归属

### 4. 核心规格与子任务文档分离

**加载顺序：**
- `00-specs/` 只放 AI 执行时**必须读取**的文件（REQ/TECH/TASK/CONTEXT）
- `_shared/` 只放跨平台共享契约（API_CONTRACT.yaml）
- 子任务目录放与执行紧密关联的文档（TEST/REVIEW/DEPLOY 等）
- AI 加载顺序：`00-specs/` → `_shared/` → `{platform}/{subtask}/`

### 5. 元信息集中化

**任务级 `.meta/`：**
- `type` / `status` / `owner` / `feature` / `created-at` / `git-config`

**子任务级 `.meta/`：**
- 同上，字段级继承：子任务未配置的字段自动继承任务级

### 6. 工程路径感知（v6.49.6+）

**代码写入位置由 CONSTITUTION.md 决定：**

| 工程标识 | 工程类型 | 源码路径 | 对应端 |
|:---|:---|:---|:---|
| booking-service | Java服务 | `../outputs-project/backend/booking-service` | 预订订单服务 |
| h5-mobile | H5移动端 | `../outputs-project/frontend/h5-mobile` | H5移动端 |

- execute 命令的 `--response` 模式检查文件路径是否以工程标识开头
- 如果是，写入对应的实际工程路径
- 如果不是，回退写入迭代目录（兼容旧行为）

---

## AI 文件加载顺序

当 AI 执行开发任务时，按以下顺序加载文件：

```
1. Task-001/.meta/type              → 了解任务类型
2. Task-001/.meta/status            → 了解当前状态
3. Task-001/.meta/feature           → 了解功能单元
4. Task-001/00-specs/CONTEXT.md     → 任务上下文 + 来源追溯
5. Task-001/00-specs/TASK.md        → 任务概览 + 产出物清单
6. Task-001/00-specs/REQ.md         → 需求 + 验收标准
7. Task-001/00-specs/TECH.md        → 技术方案 + 接口设计
8. Task-001/_shared/API_CONTRACT.yaml → API 契约
9. Task-001/00-specs/CHANGELOG.md   → 了解变更历史（如有）
10. Task-001/{platform}/{subtask}/TASK.md → 子任务详情

【补充阅读（按需）】
- {platform}/{subtask}/TEST.md      → 测试要求
- {platform}/{subtask}/RISK.md      → 风险注意点
- {platform}/{subtask}/DEPS.md      → 依赖约束
```

---

## 子任务 ID 规则

**确定性格式**（v6.49.5+）：
- 格式：`Task-{parentTaskId}-{platform}`
- 示例：`Task-001-booking-service`、`Task-001-h5-mobile`
- 保证全项目唯一，不同任务的同名端不冲突

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

### 从旧结构迁移（10-backend/ 和 20-frontend/）

```bash
# 1. 读取 CONSTITUTION.md 获取端列表
# 2. 将 10-backend/{service}/{subtask}/ 移动到 {service}/{subtask}/
# 3. 将 20-frontend/{platform}/{subtask}/ 移动到 {platform}/{subtask}/
# 4. 删除空的 10-backend/ 和 20-frontend/ 目录
# 5. 为每个任务添加 .meta/feature

# 示例：
mv Task-001/10-backend/api/impl/ Task-001/api/impl/
mv Task-001/20-frontend/h5/impl/ Task-001/h5/impl/
rmdir Task-001/10-backend Task-001/20-frontend
```

> CLI 代码保留了旧结构的回退兼容，旧项目无需立即迁移。

---

## 相关文件

| 文件 | 说明 |
|:---|:---|
| `src/commands/iteration/split.ts` | 任务拆分，创建端平铺目录结构 |
| `src/commands/task/new.ts` | 手动创建任务，适配端平铺结构 |
| `src/commands/execute.ts` | 执行任务，工程路径感知 + 子任务扫描 |
| `src/core/execution-state.ts` | 执行状态追踪 + 文件即记忆 |
| `src/core/rag-engine.ts` | RAG 索引，动态扫描子任务文档 |
| `src/core/knowledge-graph.ts` | 知识图谱，适配端平铺扫描 |
| `src/core/prompt-builder.ts` | Prompt 构建，动态加载子任务文件 + 工程路径注入 |
| `src/core/spec-paths.ts` | 工程路径解析（parseProjectInfo / getProjectPathForPlatform） |
| `src/commands/analyze.ts` | 分析时补全文档到子任务目录 |
| `src/commands/status-panel.ts` | 状态面板，适配端平铺目录 |
| `src/commands/context-output.ts` | 上下文输出，00-specs/ 优先 |
