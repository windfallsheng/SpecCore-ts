# 命令参考 (v5.27.0)

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
```
别名: `d2s`

### 📤 spec2doc — 文档导出 🔒 AI 命令
```bash
speccore spec2doc [-i <iteration>] [-t <task>] [-f <format>] [-o <output>]
```
别名: `s2d`

### 🧠 analyze — AI 分析 🔒 AI 命令
```bash
speccore analyze [--iteration <name>] [--task <id>] [--audit]
```
别名: `al`

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
├── 00-specs/           ← 核心规格 (REQ/TECH/TASK/SCHEMA/CHANGELOG)
├── _shared/            ← API 契约 (API_CONTRACT.yaml)
├── 10-backend/         ← 后端实现
├── 20-frontend/{端}/   ← 前端实现（端名来自 CONSTITUTION.md）
├── 99-artifacts/       ← 产出 (TEST/REVIEW/DEPLOY/ERROR_CODES/RISK/DEPS/MONITOR)
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
```
别名: `sy`

### ✅ validate — 合规验证
```bash
speccore validate [--iteration <name>]
```
别名: `vl`

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

## 子命令 (全量模式)

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

### ⏰ schedule — 定时调度
```bash
speccore schedule create --at "22:00" [--all] [-t <task>] [--batch-size <n>]
speccore schedule list [--status pending|completed|failed]
speccore schedule detail --id <id>
speccore schedule cancel --id <id>
speccore schedule retry --id <id> [--at "新时间"]
speccore schedule delete --id <id>
speccore schedule daemon start|stop|status
```
- 跨平台守护：macOS LaunchAgent / Linux crontab / Windows Task Scheduler
- 懒启动：create 自动安装守护并启动；无 pending 任务自动停
- 多调度并存，各自独立管理
- retry：任务未触发时可重调度
