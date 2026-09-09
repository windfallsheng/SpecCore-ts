# 命令参考 (v8.3.60)

---
title: 命令参考
---

## 命令分类

| 类型 | 说明 | 示例 |
|:---|:---|:---|
| 🔒 **AI 命令** | 需在 AI IDE（WorkBuddy/Cursor/Trae）中通过 `@spec-ask` 使用 | `doc2spec`, `analyze`, `plan`, `execute`, `pr`, `done` |
| ✅ **CLI 命令** | 可在终端直接输入 `speccore xxx` 执行 | `init`, `dashboard`, `validate`, `iteration create` |
| ⚡ **部署命令** | 支持环境驱动，通过 `--env` 读取环境配置 | `pipeline`, `build`, `deploy` |
| 🧪 **测试命令** | 支持配置驱动测试，通过 `--config` 加载测试场景 | `verify` |

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

## 核心命令 (21)

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

### ⚙️ config — 配置管理
```bash
speccore config --get <key>
speccore config --set <key> <value>
speccore config --upgrade
```
别名: `cfg`

> v8.3.25: 统一配置管理，`.speccore.yml` 为唯一配置入口。

| 选项 | 说明 |
| :--- | :--- |
| `--get <key>` | 读取配置项（支持点号路径，如 `settings.patterns.auto_save`） |
| `--set <key> <value>` | 设置配置项 |
| `--upgrade` | 升级配置结构：补全缺失字段、更新 schema_version、追加升级历史 |
| `--list` | 列出所有配置项和当前值 |

**配置版本化**：
- `.speccore.yml` 包含 `schema_version` 字段，CLI 升级时自动检测
- `schema_version` < CLI 要求时，加载时自动警告，建议运行 `--upgrade`
- 缺失字段自动用默认值补全，不因配置不完整而阻塞

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
5. `speccore split -I <iter>` → 模块驱动拆分：从 `overview/REQUIREMENT.md` 读取功能模块清单及「涉及端」列，每个模块创建一个 Task，按涉及端创建子任务目录

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
speccore analyze --task Task-001,Task-002,Task-003  # 批量分析多个子任务（v8.3.94+）
speccore analyze --filter status:doing               # 按状态自动发现并批量分析（v8.3.94+）
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
- **Phase 1**: 生成全局文档(overview/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等)，建立跨端统一视角
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

**多子任务批量分析（v8.3.94+）**：
- `--task Task-001,Task-002,Task-003`：同时分析多个子任务，生成合并 prompt
- `--filter status:doing`：按 .meta/status 自动发现并批量分析（支持 todo/doing/done）
- `--filter owner:张三`：按 .meta/owner 自动发现并批量分析
- `--filter type:feature`：按 .meta/type 自动发现并批量分析（feature/bugfix/refactor/research）
- `--filter platform:web`：按端目录自动发现并批量分析
- `--filter keyword:auth`：按关键词（任务名/feature/REQ.md 内容）自动发现并批量分析
- `--apply` 模式暂不支持多任务批量写入，需逐个任务执行

- 文档集按任务类型区分：feature → REQ/TECH/TASK/SCHEMA，bugfix → REQ/TECH
- 链式生成：文档按依赖顺序逐个生成，通过图谱 RAG 智能检索相关内容（不是无脑全读）
- 用户自定义模板：`.speccore/templates/{global|iteration|task}/` 目录，同名覆盖 + 新名追加
- **业务-代码映射**：TECH.md 末尾包含「业务-代码映射」表格，图谱自动提取并建立关联

**端发现（v6.46.0+）**：

analyze 从 CONSTITUTION.md「## 端列表」章节读取全局权威端名列表，不再动态推断。

### 📝 clarify — 需求澄清 🔒 AI 命令

```bash
speccore clarify [--to <iteration>] [--prompt] [--apply <json|@file>] [--local] [--promote <entryId>]
```

**v6.77.0+ 新增命令。** 将口语化需求描述整理为 PRD 级专业文档。
**v8.3.0+ 新增 `--local` 模式**：不绑定迭代，输出到临时工作区。

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

# 4. v8.3.0+ 临时工作区模式（不绑定迭代）
speccore clarify --from notes.md --local --prompt   # 生成 Prompt + 创建工作区条目
speccore clarify --apply '<PRD>' --local             # 写入临时工作区
speccore clarify --promote <entryId> --to <iteration> # 提升到迭代层
```

输出位置：
- 正常模式：`010-requirements/converted/clarified-{feature}.md`
- `--local` 模式：`.speccore/local/workspace/clarify/{id}/PRD.md`

### 🗃️ workspace — 临时工作区管理

```bash
speccore workspace [--list] [--show <entryId>] [--clean] [--days <n>] [--type <clarify|research>]
```
别名: `ws`

**v8.3.0+ 新增命令。** 管理独立内容处理的临时产出（不绑定迭代/任务）。

**使用场景：**
- 查看已沉淀到临时工作区的澄清/调研产出
- 清理过期的临时条目
- 查看条目的原始输入摘要

**子命令：**

```bash
speccore workspace list                    # 列出所有条目
speccore workspace list --type clarify     # 按类型过滤
speccore workspace show <entryId>          # 查看详情 + 原始输入摘要
speccore workspace clean --days 30         # 清理 30 天前的未提升条目
```

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

### ⚖️ verdict — 契约冲突裁决
```bash
speccore verdict --list [--task <id>]
speccore verdict --conflict <id> --decide <pass|pass-with-conditions|reject|defer> [--reason <说明>]
speccore verdict --report <Task-ID>
```
别名: `vd`

**三级裁决机制**：
- **L1 机器契约**：编译/测试失败 → 自动裁决驳回（无需人工）
- **L2 规范契约**：Spec 不一致/Lint 警告 → AI 生成修复建议，开发者确认
- **L3 架构契约**：安全漏洞/架构冲突 → 需人工最终裁决

**配置控制**（`.speccore.yml`）：
| 配置项 | 可选值 | 默认 | 说明 |
| :--- | :--- | :--- | :--- |
| `arbitration.enabled` | `true`/`false` | `true` | 总开关 |
| `arbitration.mode` | `full`/`l1-only`/`report-only` | `full` | 裁决深度 |

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

---

## 部署命令（v8.3.60+）

### 🚀 pipeline — 环境驱动流水线
```bash
speccore pipeline --env <环境> --all           # 全端部署
speccore pipeline --env staging --platforms h5,api  # 指定端
speccore pipeline --env test --all --dry-run   # 预览模式
speccore pipeline --env dev --all --skip-build # 跳过构建
```
别名: `pln`

**环境驱动**：自动读取 `.speccore/environments/{env}.yaml` 中的 `branch`，将当前分支合并到目标分支，然后执行 build → deploy。

**五层环境模型**：

| 环境 | 分支 | 用途 |
|:---|:---|:---|
| `local` | — | 本地开发，不 merge |
| `dev` | `develop` | 开发联调 |
| `test` | `release/test` | 测试/QA/SIT |
| `staging` | `staging` | 预发布/准生产 |
| `production` | `main` | 线上生产 |

**执行流程**：
1. 读取环境配置获取目标分支
2. 获取当前 Git 分支作为源分支
3. checkout 目标分支 → pull → merge 源分支
4. 构建（叠加环境配置中的 build_cmd）
5. 部署（叠加环境配置中的 deploy 参数）
6. 汇总报告（成功/失败 + 各步骤状态）

### 🔨 build — 按端构建
```bash
speccore build --env <环境> --platform <端名>
speccore build --env staging --all
speccore build --env dev --platform h5 --branch feature/login
```
别名: `bd`

**说明**：按 PROJECT.yaml + 环境配置叠加后的参数执行构建。支持 `--branch` 先 checkout 到指定分支再构建。

### 🚀 deploy — 按端部署
```bash
speccore deploy --env <环境> --platform <端名>
speccore deploy --env staging --all
speccore deploy --env production --platform h5 --dry-run
```
别名: `dp`

**说明**：部署端到指定环境。支持 `--dry-run` 预览、`--skip-build` 跳过构建、`--branch` 切换分支。

**部署配置参考**（PROJECT.yaml / .speccore/environments/{env}.yaml）：

| 字段 | 类型 | 必填 | 说明 |
|:---|:---|:---|:---|
| `type` | string | 是 | 部署类型：`ssh` `sftp` `static` `script` `docker` `pm2` `k8s` `helm` `vercel` `serverless` |
| `build_cmd` | string | 否 | 构建命令，如 `npm run build` |
| `output_dir` | string | 否 | 构建输出目录，默认 `dist` |
| `host` | string | ssh/sftp/pm2/docker 远程时 | 服务器地址，格式 `user@host:port`（port 可选） |
| `key` | string | 否 | SSH 私钥路径，默认 `~/.ssh/id_rsa` |
| `password` | string | 否 | SSH/SFTP 密码（v8.3.91+，需安装 `sshpass`） |
| `remote_dir` | string | ssh/sftp 时 | 服务器上的部署目录 |
| `script` | string | 否 | 部署后执行的命令或脚本路径 |
| `target` | string | static/k8s/helm/serverless 时 | 目标路径/namespace/函数名 |
| `dockerfile` | string | docker 时否 | Dockerfile 路径，默认 `./Dockerfile` |
| `registry` | string | docker 时否 | 镜像仓库地址 |
| `image` | string | docker 时否 | 镜像名，默认使用端名 |
| `tag` | string | docker 时否 | 镜像标签，默认使用环境名 |
| `pm2_config` | string | pm2 时否 | PM2 配置文件，默认 `ecosystem.config.js` |
| `provider` | string | serverless 时否 | 提供商：`aliyun-fc` `aws-lambda` `tencent-scf` |
| `pre_deploy` | string[] | 否 | 部署前执行的命令列表 |
| `post_deploy` | string[] | 否 | 部署后执行的命令列表 |

> 💡 **部署为可选功能**：如未配置部署参数，speccore 会自动跳过部署步骤，继续执行测试。详见 `templates/deploy-examples.yaml`。
>
> 详细示例：
> - `templates/deploy-java/README.md` — Java + systemd / Docker 部署
> - `templates/deploy-docker/README.md` — Docker 前后端远程部署
> - `templates/deploy-examples.yaml` — 12 种部署场景配置示例

---

## 测试命令（v8.3.60+）

### 🧪 verify — 代码验证与 UI 测试
```bash
speccore verify --ui                                    # 启用 UI 验证
speccore verify --ui --smoke-only                       # 仅冒烟测试
speccore verify --ui --visual-only                      # 仅视觉检查
speccore verify --ui --headed                           # 有头模式（显示浏览器窗口，v8.3.95+）
speccore verify --config ./tests/smoke.yaml             # 配置驱动测试
speccore verify --config ./tests/smoke.yaml --env-file test   # 合并环境配置
speccore verify --api-contract                          # API 契约测试
speccore verify --perf                                  # 性能基线测试

# 分层测试策略（v8.3.60+）
speccore verify --stage dev                             # 开发阶段：编译 + Lint + 单元测试
speccore verify --stage pr                              # PR 阶段：代码质量 + 冒烟 + API 契约
speccore verify --stage deploy                          # 部署阶段：仅冒烟测试
speccore verify --stage release                         # 发布阶段：全量 UI + API + 性能回归

# 测试外部项目（v8.3.60+）
speccore verify --project-dir ~/projects/other-app --stage deploy
speccore verify --project-dir ~/projects/other-app --config ./tests/smoke.yaml
```
别名: `vf`

**说明**：执行代码质量检查 + UI 冒烟测试 + 视觉检查 + API 契约测试 + 性能基线测试。

**配置驱动测试**：通过 `--config` 指定 YAML 测试场景文件，支持多环境、多页面、多设备批量测试。

**环境配置联动**：`--env-file` 支持环境名（如 `test`）或文件路径，自动合并环境配置中的 `base_urls` 和 `visual_model`。

**分层测试策略**：`--stage` 一键执行对应层级的测试组合，无需记忆复杂参数。

**外部项目测试**：`--project-dir` 全局选项，所有命令自动继承，测试能力可用于任意外部项目。

**浏览器内网兼容（v8.3.95+）**：
- 内网环境无需 `npx playwright install`，自动探测本机 Chrome/Edge
- 手动指定：`SPECCORE_BROWSER_PATH=/usr/bin/google-chrome speccore verify --ui`
- 未检测到浏览器时给出三种方案：在线安装 / 系统浏览器 / 离线搬运

**VERIFY_SPEC.yaml 操作与断言（v8.3.95+）**：

| 操作 | 说明 | 示例 |
|------|------|------|
| `fill` / `click` / `select` / `check` | 表单交互 | `type: fill, selector: '#name', value: admin` |
| `navigate` / `wait` / `screenshot` | 页面控制 | `type: navigate, value: /login` |
| `cookie` | 注入 Cookie（跳过登录） | `type: cookie, selector: sessionId, value: xxx, domain: 172.16.10.189` |
| `localStorage` | 注入 Token | `type: localStorage, selector: token, value: eyJhbG...` |
| `script` | 执行自定义 JS | `type: script, value: "document.querySelector('#captcha').value='888888'"` |
| `scroll` | 滚动（元素/底部/像素） | `type: scroll, selector: '.btn'` 或 `value: bottom` |
| `upload` | 文件上传 | `type: upload, selector: 'input[type=file]', value: /path/file.pdf` |
| `iframe` | 切换 iframe 上下文（v8.3.95+） | `type: iframe, selector: '#frame'` 或 `value: main`（切回） |
| `waitForRequest` | 等待网络请求发出（v8.3.95+） | `type: waitForRequest, value: '**/api/login'` |
| `waitForResponse` | 等待网络请求响应（v8.3.95+） | `type: waitForResponse, value: '**/api/login'` |
| `drag` | 拖拽排序（v8.3.95+） | `type: drag, selector: '.item-1', toSelector: '.item-3'` |
| `press` | 按键（支持组合键） | `type: press, selector: '#input', key: Control+a` |

| 断言 | 说明 | 示例 |
|------|------|------|
| `visible` / `hidden` | 元素显示状态 | `type: visible, selector: '#app'` |
| `text` / `value` / `url` / `count` / `attribute` | 内容验证 | `type: text, selector: 'h1', contains: 员工缴费` |
| `style` | CSS 样式验证（v8.3.95+） | `type: style, selector: '.btn', style: background-color, contains: 'rgb(255,0,0)'` |
| `visual` | 视觉对比（需配置视觉模型） | `type: visual, threshold: normal` |

### 🧠 knowledge — 知识图谱可视化与代码图谱查询
```bash
speccore knowledge [-i <iteration>] [--export html] [--scope global|iteration|task]
```
别名: `kg`

生成交互式 HTML 知识图谱，支持：
- **vis-network 力导向图**：8 种形状区分实体类型（需求◆ 规格🛢 功能模块■ 任务▲ 全局★ 源码⬡）
- **衰减检测**：自动发现内容变更、下游过期、文件丢失、代码超前等风险
- **RAG 上下文预览**：查看 AI 检索时会注入的完整上下文
- **9 套主题 / 3 种字体 / 4 档字号 / 全屏模式 / 实体搜索**

**v6.90.0+ 代码知识图谱**（本地 AST 解析，零 LLM Token）：
```bash
speccore code-index --graph --scope src           # 构建代码知识图谱
speccore knowledge-explain "buildCodeGraph"       # 解释节点及其连接
speccore knowledge-path "AuthModule" "UserDB"     # 查找最短依赖路径
speccore knowledge-query "how does payment work"  # 自然语言查询
```

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
