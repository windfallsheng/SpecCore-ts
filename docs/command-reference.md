# 命令参考 (v6.67.0)

---
title: 命令参考
---

## 命令分类

| 类型 | 说明 | 示例 |
|:---|:---|:---|
| 🔒 **AI 命令** | 需在 AI IDE（WorkBuddy/Cursor/Trae）中通过 `@spec-ask` 使用 | `doc2spec`, `analyze`, `plan`, `execute`, `pr`, `done` |
| ✅ **CLI 命令** | 可在终端直接输入 `speccore xxx` 执行 | `init`, `dashboard`, `validate`, `iteration create` |

> 💡 AI 命令在 AI IDE 中也可通过 `/spec-xxx` 快捷命令或 `@spec-ask "描述"` 自然语言方式使用。

## 总览

### 架构

```
speccore ask ←── 万能 AI 入口 ──→ speccore dev
    │                                  │
    ├─ 📖 命令解释                      ├─ 初始化→导入→分析→拆分
    ├─ 🗺️ 任务指引                      ├─ 计划→执行→PR→归档
    ├─ 🎯 意图匹配                      └─ 7 阶段自动推进
    └─ ⚡ 复杂编排
```

### TTY 智能适配

| 环境 | ask | welcome | dev | dashboard |
|------|:--:|:--:|:--:|:--:|
| 终端 | Unicode 框线 | Unicode 框线 | 文本输出 | 文本输出 |
| AI 调用 | HTML 页面 | HTML 页面 | HTML 页面 | HTML 页面 |

---

## 核心命令 (19)

### 🧠 ask — 万能 AI 入口 🔒 AI 命令
```bash
speccore ask "<自然语言描述>"
```
四种模式自动识别: 📖命令解释 / 🗺️任务指引 / 🎯意图匹配 / ⚡复杂编排

**双模式确认**: 未说"自主/一键"→ 展示理解等确认；说了自主 → 确认后全自动执行

**使用示例**：
```bash
# AI 窗口中（推荐）：
直接说 "帮我分析登录需求"          # 自然语言，AI 自动路由
/spec-ask "执行 Task-001"             # 斜杠命令，显式触发

# 终端中：
speccore ask "拆分任务"              # 显式调用意图识别
speccore ask "查看进度"              # 匹配到 dashboard
```

> 💡 Skill（`.agents/skills/spec-ask/SKILL.md`）在 `init` 后自动加载，AI 已具备完整行为规则。
> `/spec-ask` 斜杠命令只是手动快捷入口，与自然语言效果相同。

### 🏷️ about — 版本信息
```bash
speccore about
```
生成 HTML 版本信息页：功能概览 + 近期亮点 + 里程碑 + 文档链接

### 🏷️ welcome — 项目名片
```bash
speccore welcome [--web] [--output <path>]
```
显示项目状态、流水线阶段、ask 使用引导

### 📊 dashboard — 仪表盘
```bash
speccore dashboard [--scope global|iteration] [--export html] [--health] [--lifecycle]
```
别名: `db`, `sp`

### 🔄 dev — 智能级联 🔒 AI 命令
```bash
speccore dev [--auto] [--from <phase>] [--to <phase>]
```
别名: `d`

### 🏗️ init — 项目初始化
```bash
speccore init [--tool <tool>] [--force] [--interactive]
```
别名: `in`

> v5.30: 已初始化项目再执行 init 会自动更新工具命令和 Skill 文件，不覆盖用户配置。

| 选项 | 说明 |
| :--- | :--- |
| `--tool <tool>` | 指定工具: trae, claude, codebuddy, cursor, windsurf（逗号分隔）|
| `--update` | 仅更新命令文件和 Skill，不重置配置（版本相同时提示 `--force` 强制更新） |
| `--force` | 强制重置全部配置（自动备份 `.speccore/` + `Iteration-*/` + `inbox/` + `questions/` 到项目根目录的 `.speccore-backup-<timestamp>/`，提供恢复指令） |
| `--interactive` | 交互式引导创建 |

> 💡 init 完成后自动生成配置引导页 `outputs/speccore-setup-guide.html`，包含 6 步引导（技术宪法 → 团队配置 → 创建迭代 → 导入需求 → 知识库 → 开始开发），可在浏览器中打开查看。

![Setup Guide](screenshots/setup-guide-top.png)

### 📝 doc2spec — 文档导入 🔒 AI 命令
```bash
speccore doc2spec -f <file> --iter <iteration> [--task <task>] [--no-ai]
speccore doc2spec --classify --prompt -I <iteration>   # 智能分类 sources/ 文档
speccore doc2spec --classify --response <json> -I <iteration>
```
别名: `d2s`

**智能分类模式（`--classify`）：**

| 参数 | 说明 |
|:--|:--|
| `--classify` | 启用智能分类模式 |
| `--prompt` | 输出分类 Prompt 给 AI（AI 理解文档意图后返回 JSON） |
| `--response <json>` | 接收 AI 分类结果，写入 `staging/` |
| `-I, --iter <iteration>` | 目标迭代 |

**分类流程：**

1. 将待分类文档放入 `010-requirements/sources/`
2. `speccore doc2spec --classify --prompt -I <iter>` → AI 理解文档意图（nature）+ 映射类型（type）
3. `speccore doc2spec --classify --response <json> -I <iter>` → 写入 `staging/`
4. `speccore analyze -I <iter>` → 按类型路由到 `020-specs/{features,bugs,refactors,research}/`
5. `speccore split -I <iter>` → 模块驱动拆分：从 `global/REQUIREMENT.md` 读取功能模块清单及「涉及端」列，每个模块创建一个 Task，按涉及端创建子任务目录

**AI 意图理解：**

| 文档实际意图（nature） | 映射类型（type） | 示例 |
|:---|:---|:---|
| 新功能、功能需求 | feature | "扫码登录" |
| 缺陷、安全问题 | bugfix | "XSS 漏洞"、"登录超时" |
| 技术债、性能优化 | refactor | "首页加载慢" |
| 调研、选型 | research | "WebSocket vs SSE" |

### 📤 spec2doc — 文档导出 🔒 AI 命令
```bash
speccore spec2doc [-i <iteration>] [-t <task>] [-f <format>] [-o <output>]
```
别名: `s2d`

### 🧠 analyze — AI 分析 🔒 AI 命令
```bash
speccore analyze [--iteration <name>] [--task <id>] [--audit]
speccore analyze --full              # 全量分析（原 synthesize）
speccore analyze --auto              # 全自动分析（经过 AI，不交互）
speccore analyze --auto --platform admin  # 只分析指定端
speccore analyze --task Task-001     # 任务级深度分析（split 后执行）
speccore analyze --global --withCode # 全局代码分析（四层扫描+功能模块驱动）
speccore analyze --clarify           # 需求专业度检测，口语化时自动澄清
speccore analyze --dev-guide         # 分析同时生成 DEV_GUIDE.md 开发者实现指南
```
别名: `al`

> 💡 `--auto` 模式会自动生成 prompt 交给宿主 AI 执行专业分析，产出全套 Spec 文件。支持 `--platform` 指定端过滤。
>
> **v6.77.0+ 新增参数：**
> - `--clarify`: 检测需求文档专业度，若过于口语化（"我要/我想/能不能"），自动进入 clarify 流程整理为 PRD 级文档
> - `--dev-guide`: 同时生成 DEV_GUIDE.md 三级开发者实现指南（全局级/端级/任务级）
> - `--apply @file.json`: Windows 兼容方式，从文件读取 JSON 避免 shell 转义问题

**分阶段分析架构(v6.64.0)**:
- **Phase 1**: 生成全局文档(global/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等)，建立跨端统一视角
- **Phase 2**: 生成各端专属文档({端}/TECH.md、TEST.md、UI_SPEC.md 等)，参考全局上下文后注入端专属专业维度
- **自动触发**: CLI 在 Phase 1 完成后,检测到 ≥2 个端时自动输出 Phase 2 prompt,无需用户手动执行两次命令
- **自动模式(v6.71.0+)**: `--auto` 下 AI 直接推断执行 Phase 2，无需用户确认

**全局代码分析 — 四层扫描架构(v6.71.2+)**:
```bash
speccore analyze --global --withCode
```
- **Layer 1**: 快速扫描所有端 → 各端 `_INDEX.md`（只提取索引，不深入代码）
- **Layer 2**: 跨端关联分析 → `_ASSOCIATION.md` + `_MODULES.md`（匹配前后端接口、识别公共服务、归纳功能模块）
- **Layer 3**: 按功能模块深入分析（不是按端）→ 逐个功能模块读取涉及端的详细源码
- **Layer 4**: 全局汇总 → `REQUIREMENT.md` / `FUNCTION_MAP.md` / `INTERACTION_MAP.md` / `API_CONTRACT.yaml` / `ARCHITECTURE.md` / `CONSISTENCY_CHECK.md`

**前后端分析视角分离(v6.71.1+)**:
- **后端端（*service）**: 纯技术视角 — API 设计、数据库、缓存、并发、安全、性能
- **前端端（h5/admin/miniapp）**: 产品+技术双视角 — 用户旅程、页面清单、交互设计、字段展示、API 调用清单

**迭代分析全局关联(v6.71.3+)**:
- 迭代分析前自动读取全局层产物（`GLOBAL/REQUIREMENT.md`、`GLOBAL/FUNCTION_MAP.md`、`GLOBAL/API_CONTRACT.yaml` 等）
- 功能模块清单新增「全局对比」列：新增 / 扩展 / 重构 / 复用
- 自动识别迭代需求与全局层的冲突和依赖

**图谱 RAG 智能检索**:
- Phase 1/Phase 2 执行前均调用 `unifiedSearch()` 从知识图谱和 RAG 索引中检索项目关联内容
- Phase 1 完成后自动调用 `refreshKnowledgeGraph()` 重建知识图谱和 RAG 索引
- 确保 Phase 2 能基于最新的全局文档生成各端专属方案

**任务级深度分析（v6.44.0+）**：

split 后，每个 Task 的 00-specs/ 已有基础内容（机械提取）。执行 `analyze --task` 时，AI Read 这些内容 + global/ 全局上下文 + {端}/ 专属上下文，重新生成任务级深度分析。

- 文档集按任务类型区分：feature → REQ/TECH/TASK/SCHEMA，bugfix → REQ/TECH
- 链式生成：文档按依赖顺序逐个生成，通过图谱 RAG 智能检索相关内容（不是无脑全读）
- 用户自定义模板：`.speccore/templates/{global|iteration|task}/` 目录，同名覆盖 + 新名追加
- **业务-代码映射**：TECH.md 末尾包含「业务-代码映射」表格，图谱自动提取并建立关联

**端发现（v6.46.0+）**：

analyze 从 CONSTITUTION.md「## 端列表」章节读取全局权威端名列表，不再动态推断。

### 📝 clarify — 需求澄清 🔒 AI 命令

```bash
speccore clarify [--to <iteration>] [--prompt] [--apply <json|@file>]
```

**v6.77.0+ 新增命令。** 将口语化需求描述整理为 PRD 级专业文档。

**使用场景：**
- 用户输入 "我要加个购物车功能" → 触发 clarify → 输出结构化需求文档
- 用户输入 "能不能帮忙改下登录页" → 触发 clarify → 补充验收标准、技术约束

**专业度检测指标：**
- 口语化表达（"我要/我想/能不能"）
- 缺少结构化标题（## / ###）
- 缺少验收标准（AC）
- 缺少技术约束
- 缺少错误处理说明
- 缺少数据模型

**工作流程：**
```bash
# 1. Prompt 模式：生成整理 Prompt
speccore clarify --to Iteration-001 --prompt

# 2. Apply 模式：应用 AI 整理结果
speccore clarify --to Iteration-001 --apply '{...json...}'

# 3. Windows 兼容：从文件读取
speccore clarify --to Iteration-001 --apply @result.json
```

输出位置：`010-requirements/converted/clarified-{feature}.md`

### 📦 split — 任务拆分 🔒 AI 命令
```bash
speccore iteration split [-i <iteration>] [-f <file>] [-g <level>] [--force] [--interactive]
```
别名: `sp`

**参数说明：**

| 参数 | 说明 |
|:--|:--|
| `-i, --iteration <name>` | 目标迭代名称（短名，如 `Q1`） |
| `-f, --file <file>` | 需求文件路径（默认 `REQUIREMENT.md`） |
| `-g, --granularity <level>` | 拆分粒度: `macro`(粗) / `module`(中,默认) / `atomic`(细) |
| `--modules <names>` | 只拆分指定功能模块（逗号分隔，如 `"购物车,订单"`） |
| `--platforms <list>` | 只拆分指定端（逗号分隔，如 `api,h5`） |
| `--prune` | 清理不匹配的旧任务 |
| `--dev-guide` | 生成任务级 DEV_GUIDE.md 开发者实现指南 |
| `--ignore-specs-update` | 跳过 020-specs/ 变更检测 |
| `--interactive` | 逐任务交互确认（默认开启） |
| `--force` | 已有任务时强制覆盖（清理旧任务后重建） |
| `--prompt` | 输出结构化 Prompt（Skill 协作模式） |
| `--response <json>` | 接收 AI 拆分结果，逐任务确认后创建目录 |

**拆分粒度：**

> ⚠️ 工时约束按 **max(各端工时)** 计算，即单个开发人员的实际工作量，不是所有端的总和。

| 粒度 | 每人工时 | 接口上限 | 数据表上限 | 适用团队 |
|:--|:--|:--|:--|:--|
| macro | 20-80h (1-2周) | 15 | 5 | 1-3 人 |
| module | 12-40h (3-5天) | 8 | 3 | 3-8 人 |
| atomic | 4-24h (1-3天) | 3 | 2 | 8+ 人 |

粒度由 STAFFING.md 团队规模自动推荐，用户可通过 `--granularity` 手动覆盖。

**拆分约束（功能单元基准）：**

- 核心原则：以需求的功能单元为基准拆分，而非需求文档的章节划分
- 每个功能单元默认 1 个任务，最多 3 个
- AI 在 JSON 中标注 `functionalUnit` 字段，代码层按功能单元分组校验
- 超过上限时终止（可用 `--force` 跳过）

**交互流程：**

```
AI 输出 JSON 拆分方案
  → CLI 逐任务展示摘要（名称/类型/各端工时分布/依赖/验收标准）
  → 用户确认 (y/回车) 创建，或 n 退出并提示调整方式
  → 粒度不达标时自动警告（按单人 max 工时校验）
  → 创建完整任务目录结构
```

> 💡 如需调整拆分方案，按 n 退出后回到宿主 AI 对话，用自然语言调整（如“合并”“拆分”“改工时”），AI 重新生成方案后再次执行。

**任务目录结构：**

```
030-tasks/{type}/Task-NNN-slug/
├── .meta/              ← 元信息 (type/status/owner)
├── 00-specs/           ← 核心规格 (REQ/TECH/CONTEXT/TASK/SCHEMA/CHANGELOG)
├── _shared/            ← API 契约 (API_CONTRACT.yaml)
├── 10-backend/         ← 后端实现
│   └── {服务}/{子任务}/ ← 子任务目录 (.meta/src/tests/TASK.md)
├── 20-frontend/{端}/   ← 前端实现
│   └── {子任务}/        ← 子任务目录 (.meta/src/tests/TASK.md)
└── .issues.md          ← 问题追踪
```

**示例：**

```bash
# 默认拆分（自动推荐粒度）
speccore iteration split -i Q1

# 指定粗粒度（小团队）
speccore iteration split -i Q1 -g macro

# 强制重新拆分（清理旧任务）
speccore iteration split -i Q1 --force
```

### 📐 plan — 执行计划 🔒 AI 命令
```bash
speccore plan [--all] [--task <id>] [--interactive]
```
别名: `pl`

### ⚡ execute — 开发执行 🔒 AI 命令
```bash
speccore execute [--task <id>] [--batch-size <n>] [--auto]
speccore execute --ignore-upstream-update  # 跳过上游 020-specs/ 变更检测
```
别名: `ex`

### 🔀 pr — Pull Request 🔒 AI 命令
```bash
speccore pr [--task <id>] [--auto]
```
别名: `mr`

### ✅ done — 归档收尾 🔒 AI 命令
```bash
speccore done [--task <id>] [--all] [--interactive]
```
别名: `dn`

### 🔄 change — 需求变更 🔒 AI 命令
```bash
speccore change "<描述>" [--task <id>]
```
别名: `ch`

### 🔄 sync — 双向同步
```bash
speccore sync [--global] [--iteration <name>]
speccore sync --global --direction to_global   # 迭代 → 全量层
```
别名: `sy`

> 💡 `--global` 选项整合了原 `sync-global` 命令（sync-global 保留为向后兼容别名）。

### ✅ validate — 合规验证
```bash
speccore validate [--iteration <name>]
```
别名: `vl`

### 🧠 knowledge — 知识图谱可视化
```bash
speccore knowledge [-i <iteration>] [--export html] [--scope global|iteration|task]
```
别名: `kg`

生成交互式 HTML 知识图谱，支持：
- **vis-network 力导向图**：8 种形状区分实体类型（需求◆ 规格🛢 功能模块■ 任务▲ 全局★ 源码⬡）
- **衰减检测**：自动发现内容变更、下游过期、文件丢失、代码超前等风险
- **RAG 上下文预览**：查看 AI 检索时会注入的完整上下文
- **9 套主题 / 3 种字体 / 4 档字号 / 全屏模式 / 实体搜索**

![Knowledge Graph](screenshots/knowledge-graph-full.png)

![Knowledge Graph Zoom](screenshots/knowledge-graph-zoom.png)

### 🔗 track — 全链路追踪
```bash
speccore track [--req <id>] [--task <id>] [--full]
```
别名: `trk`

### 🔍 search — 全文搜索
```bash
speccore search <query> [--task <id>] [--iteration <name>]
```
别名: `sh`

### ✏️ rename — 重命名
```bash
speccore rename [--iteration <old> <new>] [--task <old> <new>]
```
别名: `rn`

### 📜 ops — 操作历史
```bash
speccore ops
```
别名: `op`

---

## 子命令

### iteration
```bash
speccore iteration create -n <name>          # ✅ CLI
speccore iteration split                      # 🔒 AI 命令
speccore iteration list                       # ✅ CLI
```
别名: `it`

### task
```bash
speccore task new --name <name>
speccore task list
speccore task status
```
别名: `tk`

### ⏰ schedule — 定时调度 [已废弃]
```bash
speccore schedule
```
> ℹ️️ 定时调度已由 WorkBuddy Automations 替代，此命令已废弃。
