# SpecCore CLI

> **Code by Spec, Not by Vibe.**

[![npm version](https://img.shields.io/npm/v/speccore.svg)](https://www.npmjs.com/package/speccore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

SpecCore CLI 是 [SpecCore 规范驱动开发框架](https://github.com/windfallsheng/SpecCore) 的官方 TypeScript 命令行工具。它将确定性操作（文件创建、目录管理、格式校验、状态统计）从 AI 中剥离，由代码直接执行，提升效率并降低 Token 消耗。

> 💡 **v4.0.0** | 命令 39 个 | 意图识别 31 种 | 多平台支持

---

## 🧩 两种使用方式

SpecCore 由两部分组成，**职责明确，互不混淆**：

| | 🔧 终端命令（CLI） | 🤖 AI 命令（Slash Command） |
| :--- | :--- | :--- |
| **在哪里执行** | 终端 / Terminal | AI 编程工具（WorkBuddy / Cursor / Claude 等） |
| **怎么用** | `speccore init` | 输入 `/spec-xxx` |
| **什么原理** | TypeScript 编译，直接操作文件 | Markdown 指令，AI 读取后执行 |
| **数量** | 39 个 | 39 个（对应 Slash Command） |
| **何时用** | 项目初始化、文件校验、批量操作 | 日常开发：需求管理、开发执行、审查归档 |

> 💡 **简单记忆**：`speccore` 开头 → 终端执行；`/spec` 开头 → AI 工具中执行。

**SpecCore CLI 是 Slash Command 的底层执行引擎**。AI 负责理解意图和生成代码，CLI 负责所有的文件操作、结构校验和状态统计。

---

## 特性亮点

- **🚀 快速初始化**：一行命令初始化完整项目结构（含 WorkBuddy / Cursor 等 8 种工具适配）
- **📁 智能目录管理**：自动创建期次、任务、共享资源目录，符合 SpecCore 规范
- **📱 多平台支持**：`--platforms=web,h5,miniapp` 按端管理 Task，动态添加平台类型
- **🧠 意图识别引擎**：31 种意图类型，200+ 关键词，自然语言自动匹配命令
- **🌐 多项目全量层**：GLOBAL/ 目录管理跨项目需求索引、架构和技术栈
- **✅ 自动合规检查**：扫描所有 Spec 文件，检查必填项和格式
- **📊 实时进度追踪**：自动识别活跃期次，统计任务完成率，支持按平台统计
- **🏥 健康度看板**：4 维度 12 指标评估项目健康状态
- **📈 一键报告**：支持 Markdown / HTML / JSON 多格式输出
- **🤖 WorkBuddy 集成**：`init` 自动创建 `.workbuddy/` skill 和项目记忆文件
- **🔄 确定性执行**：文件操作、格式校验、状态统计全部本地代码执行，零 Token 消耗

---

## 设计理念

SpecCore 采用**确定性逻辑与智能逻辑解耦**的架构：

| 逻辑类型 | 职责 | 执行方 | 示例 |
| :--- | :--- | :--- | :--- |
| **确定性逻辑** | 结构化操作 | CLI 代码 | 创建目录、读写文件、解析 YAML、校验格式、统计状态 |
| **智能逻辑** | 理解与决策 | AI 工具 | 理解需求、拆分任务、生成代码、审查产出 |

```
用户输入（自然语言 / Slash Command）
        │
        ▼
┌───────────────────────────────────────┐
│   AI 层（智能决策）                     │
│   - 理解用户意图                       │
│   - 决定执行哪些操作                   │
│   - 生成代码内容                       │
└───────────────────────────────────────┘
        │ 调用 CLI 命令
        ▼
┌───────────────────────────────────────┐
│   CLI 层（确定性执行）                  │
│   - 创建目录结构                       │
│   - 读写配置和 Spec 文件               │
│   - 解析 YAML                          │
│   - 合规校验                           │
│   - 输出结构化结果（JSON/Markdown）      │
└───────────────────────────────────────┘
```

**核心收益**：目录检查、YAML 解析、状态统计由代码确定执行，AI 只负责"解读结果"和"格式化输出"，Token 消耗大幅降低。

---

## 环境要求

- **Node.js**: >= 18.0.0
- **操作系统**: macOS / Linux / Windows

---

## 安装

```bash
# 全局安装（推荐）
npm install -g speccore

# 或使用 npx（无需安装，每次使用最新版）
npx speccore --version

# 安装指定版本
npm install -g speccore@4.0.0
```

---

## 快速开始（5 分钟）

### 1. 初始化项目

```bash
cd my-project
speccore init                    # 全新项目
speccore init --force            # 强制覆盖已有配置

# init 自动完成：
#   ✅ 创建 .speccore/ 完整目录结构（含 GLOBAL/ 全量层）
#   ✅ 创建 .workbuddy/ WorkBuddy 集成文件
#   ✅ 创建 .speccore/config/platforms.yaml 多平台配置
#   ✅ 更新 .gitignore
```

生成的项目结构：

```
.speccore/
├── CONSTITUTION.md              # 技术宪法（定义技术栈、规范）
├── SETTINGS.md                  # 框架配置（开关、模式）
├── GLOBAL/                      # 全量层：多项目统一管理
│   ├── INDEX.md                 # 需求索引（全量地图）
│   ├── OVERVIEW.md              # 项目全景
│   ├── ARCHITECTURE.md          # 技术架构（Mermaid 图）
│   ├── TECH_STACK.md            # 技术栈汇总
│   ├── PROJECTS/                # 各项目需求文档
│   ├── BASELINES/               # 版本基线快照
│   └── ...
├── config/
│   └── platforms.yaml           # 前端平台配置（web/h5/miniapp）
├── ITERATIONS/                  # 期次索引
├── PATTERNS/TEMPLATES/          # 设计模式模板（crud/auth/export/report）
├── PROJECT/                     # 项目级资产
├── RULES/                       # 审查和维护规则
└── local/
    └── context.json             # 运行时上下文
```

### 2. 导入项目到全量层

```bash
# 导入后端项目
speccore import --project=user-service --path=./user-service --type=backend

# 导入前端项目（选择性导入 + 忽略特定包）
speccore import --project=frontend-web --path=./web --type=web --scope=api --ignore=node_modules,dist

# 增量同步模式
speccore import --project=user-service --path=./user-service --update
```

### 3. 创建期次和任务

```bash
# 创建期次
speccore iteration create --name 2026-07-用户系统

# 从全量层选择需求生成期次
speccore iteration-from-global --reqs=REQ-001,REQ-002 --name=2026-07-用户系统

# 创建多平台 Task
speccore new-task --name 用户登录 --platforms=web,h5
speccore new-task --name 用户管理 --backend-only
speccore new-task --name 移动端首页 --frontend-only

# 创建传统单任务
speccore task new --name 日志审计 --type feature
```

### 4. 添加新平台类型

```bash
# 动态添加平板端
speccore platform-add --name=tablet --description="平板端" --tech="React Native"

# 添加后自动：更新 platforms.yaml + 为现有 Task 创建 frontend/tablet/ 目录
```

### 5. 查看进度和上下文

```bash
# 查看整体进度
speccore progress

# 按平台 / 人员 / 类型统计
speccore progress --platform=web
speccore progress --assignee=张三
speccore progress --format json

# 查看 Task 上下文和依赖链
speccore context --task=Task-001
```

### 6. 分析和管理

```bash
# 智能入口（自然语言）
speccore spec "进度怎么样了"          # → 自动匹配 progress
speccore spec "分析 REQ-001 影响"     # → 自动匹配 impact

# 变更影响分析
speccore impact --req=REQ-001

# 创建版本基线
speccore baseline create --name=2026-Q3-Release

# 智能审计
speccore audit --strict

# 生成可视化仪表盘
speccore dashboard

# 查看全量状态
speccore global-status
```

---

## 按场景使用

| 我想… | 命令 | 别名 |
| :--- | :--- | :--- |
| 快速开始一个功能 | `speccore spec "做一个登录功能"` | — |
| 修复 Bug | `speccore bugfix --title="登录超时"` | `bf` |
| 技术调研 | `speccore research --topic="消息队列选型"` | `rs` |
| 需求变更 | `speccore change --req=REQ-001 --desc="增加验证码"` | `cg` |
| 代码同步回 Spec | `speccore sync --task=Task-001` | `sy` |
| 同步到全量层 | `speccore sync-global --iteration=2026-07-用户系统` | `sg` |
| 生成交接文档 | `speccore handover --iteration=2026-07-用户系统` | `ho` |
| 期次回顾 | `speccore retro --iteration=2026-07-用户系统` | `rt` |
| 重命名 | `speccore rename --target=旧名 --new-name=新名` | `rn` |
| 批量重命名 | `speccore rename --batch --pattern="Task-" --replacement="Feature-"` | `rn` |
| 重建需求索引 | `speccore index-update --dry-run`（预览）/ 去掉即执行 | `iu` |
| 添加代码模板 | `speccore template-add --name=my-template` | `ta` |
| 配置管理 | `speccore config` | `cf` |

---

## 完整命令列表

### 🧠 智能入口

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore spec "<query>"` | — | 自然语言意图识别，自动匹配命令 |

### 🌐 初始化与导入

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore init` | `in` | 初始化 Speccore 项目 |
| `speccore import` | `imp` | 导入项目到全量层（--scope / --ignore / --update） |

### 📋 期次管理

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore iteration create` | `it cr` | 创建期次 |
| `speccore iteration split` | `it sp` | 需求拆分为 Task |
| `speccore iteration-from-global` | `ifg` | 从全量层选择需求生成期次 |

### 📱 任务管理

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore new-task` | `nt` | 创建多平台 Task（--platforms=web,h5） |
| `speccore task new` | — | 创建传统单任务 |

### ⚡ 执行与调度

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore plan` | `pl` | 生成智能调度方案（DAG 依赖分析） |
| `speccore execute` | `ex` | 执行任务（--platform / --priority / --status） |

### 🔄 变更与同步

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore change` | `cg` | 需求变更联动 |
| `speccore sync` | `sy` | 代码 → Spec 反向同步 |
| `speccore sync-global` | `sg` | 期次 → 全量层双向同步 |

### ✅ 验证与审查

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore validate` | `rv` | 合规性检查（--fix 自动修复） |
| `speccore progress` | `pg` | 进度查看（--platform / --detail） |
| `speccore status` | `st` | 项目状态看板 |
| `speccore health` | `hl` | 健康度看板（4 维度 12 指标） |
| `speccore report` | `rp` | 生成项目报告 |

### 🔬 分析审计

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore impact` | `if` | 变更影响分析 |
| `speccore baseline` | `bl` | 版本基线管理（create / list / compare / restore） |
| `speccore dashboard` | `db` | 生成可视化仪表盘（Chart.js HTML） |
| `speccore audit` | `ad` | AI 智能审计（重复 / 歧义 / 冲突检测） |

### 🌐 全量层管理

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore global-status` | `gs` | 全量层状态总览 |
| `speccore history` | `hs` | 需求变更历史 |
| `speccore index-update` | `iu` | 扫描需求重建 GLOBAL/INDEX（--dry-run 预览） |

### 🎯 场景命令

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore goal` | — | 完整需求交付（需求 → 代码全流程） |
| `speccore bugfix` | `bf` | 快速 Bug 修复 |
| `speccore research` | `rs` | 技术调研与选型 |
| `speccore handover` | `ho` | 生成交接文档 |
| `speccore retro` | `rt` | 期次回顾总结 |
| `speccore rename` | `rn` | 重命名期次 / 任务（自动更新所有引用） |
| `speccore platform-add` | `padd` | 动态添加前端平台类型 |
| `speccore context` | `ctx` | 查看 Task 上下文和依赖链 |

### 🛠️ 工具

| 命令 | 别名 | 说明 |
| :--- | :--- | :--- |
| `speccore template-add` | `ta` | 添加代码模板到 PATTERNS |
| `speccore archive` | `ar` | 归档已完成任务 |
| `speccore config` | `cf` | 框架配置管理 |
| `speccore help` | `hp` | 分类命令帮助 |
| `speccore demo` | `dm` | 5 分钟快速体验 |
| `speccore welcome` | `wc` | 首次使用交互引导 |

---

## 🏗️ 架构

```
.speccore/GLOBAL/   ← 全量层：多项目统一需求管理
.speccore/           ← 全局层：项目宪法、配置、模式
期次-XXX/            ← 期次层：这一期做什么
  ├── Task-XXX/      ← 任务层：这个功能怎么做
  │   ├── _shared/   ← 共享层：API Contract + 业务规则（所有平台共享）
  │   ├── backend/   ← 后端：REQ.md + TECH.md + TASK.md
  │   └── frontend/  ← 前端：按平台分目录
  │       ├── web/
  │       ├── h5/
  │       └── miniapp/
  └── ...
```

---

## 项目结构

```
speccore/
├── package.json
├── tsconfig.json
├── README.md
├── bin/
│   └── speccore                    # CLI 入口脚本
├── src/
│   ├── index.ts                    # 入口
│   ├── cli.ts                      # CLI 命令注册（Commander.js）
│   ├── commands/                   # 39 个命令实现
│   │   ├── init.ts                 # 初始化（含 WorkBuddy 集成）
│   │   ├── import.ts               # 多项目导入
│   │   ├── new-task.ts             # 多平台 Task 创建
│   │   ├── platform-add.ts         # 动态平台添加
│   │   ├── context.ts              # 上下文查看
│   │   ├── index-update.ts         # 全量索引更新
│   │   ├── execute.ts / plan.ts    # 执行与调度
│   │   ├── impact.ts / audit.ts    # 分析审计
│   │   ├── baseline.ts / dashboard.ts  # 基线 & 仪表盘
│   │   └── ...                     # 更多命令
│   ├── core/                       # 核心引擎
│   │   ├── context.ts              # 上下文管理
│   │   ├── state.ts                # 状态管理
│   │   ├── global-layer.ts         # 全量层管理
│   │   ├── intent-recognition.ts   # 意图识别引擎（31 种意图）
│   │   ├── validator.ts            # 合规检查
│   │   └── yaml-parser.ts          # YAML 解析
│   ├── templates/                  # 内置模板
│   └── utils/                      # 工具函数
│       ├── logger.ts               # 日志（含进度条、Spinner）
│       ├── file.ts                 # 文件操作
│       └── git.ts                  # Git 工具
└── dist/                           # 编译输出
```

---

## 开发指南

```bash
# 克隆仓库
git clone https://github.com/windfallsheng/SpecCore-ts.git
cd SpecCore-ts/ts-cli

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 开发模式（监听文件变化自动编译）
npm run watch

# 本地测试
node dist/cli.js --version

# 链接到全局（开发测试）
npm link
speccore --version

# 运行验证脚本
bash verify.sh
```

---

## 工具适配

| 国内 | 国际 |
| :--- | :--- |
| WorkBuddy / Qcoder / Trae | Cursor / Claude Code / Windsurf / Gemini CLI / OpenCode |

SpecCore CLI 通过 `speccore init` 自动创建 `.workbuddy/` skill 文件，配置后 AI 工具即可识别 SpecCore 项目并调用 CLI 命令。更多工具适配说明请参考 [SpecCore 源项目文档](https://github.com/windfallsheng/SpecCore)。

---

## 常见问题

| 问题 | 答案 |
| :--- | :--- |
| **安装后命令找不到？** | 确保 npm 全局 bin 目录在 PATH 中：`export PATH="$(npm bin -g):$PATH"` |
| **如何更新？** | `npm update -g speccore` |
| **如何卸载？** | `npm uninstall -g speccore` |
| **与 AI 工具如何配合？** | AI 调用 CLI 执行确定性操作。如 `/spec-validate` → `speccore validate` |
| **期次里可以放多个需求吗？** | ✅ 可以。放到期次目录，运行 `speccore index-update` 更新索引 |
| **同一个功能多端怎么管理？** | `speccore new-task --platforms=web,h5,miniapp`，按端执行和统计 |
| **如何添加新平台？** | `speccore platform-add --name=tablet --tech="React Native"` |
| **期次 / Task 想改名？** | `speccore rename --target=旧名 --new-name=新名` |
| **批量重命名？** | `speccore rename --batch --pattern="Task-" --replacement="Feature-"` |
| **需求编号重复？** | `speccore validate --fix` 自动检测修复 |

---

## 相关项目

| 项目 | 说明 | GitHub | Gitee |
| :--- | :--- | :--- | :--- |
| **SpecCore 框架** | 规范驱动开发方法论 + Slash Commands + 模板 | [GitHub](https://github.com/windfallsheng/SpecCore) | [Gitee](https://gitee.com/windfullsheng/spec-core) |
| **SpecCore CLI** | TypeScript CLI 工具（确定性操作执行引擎） | [GitHub](https://github.com/windfallsheng/SpecCore-ts) | [Gitee](https://gitee.com/windfullsheng/spec-core-ts) |

---

## 文档

| 文档 | 说明 |
| :--- | :--- |
| [SpecCore 框架 README](https://github.com/windfallsheng/SpecCore) | 完整框架介绍、AI 命令参考、按场景使用、工具适配 |
| [SpecCore 快速开始](https://github.com/windfallsheng/SpecCore/blob/main/docs/快速开始.md) | 从零上手：初始化 → 创建期次 → 拆分 → 执行 → 审查 |
| [SpecCore 命令参考](https://github.com/windfallsheng/SpecCore/blob/main/docs/命令参考.md) | 39 个 AI 命令 + 31 种意图映射 |
| [SpecCore 更新日志](https://github.com/windfallsheng/SpecCore/blob/main/CHANGELOG.md) | 源项目版本历史 |

---

## 更新日志

### v4.0.0 (2026-07-09) — 最新

- 🆕 **新增命令**：`new-task`（多平台）、`platform-add`（动态平台）、`index-update`（索引重建）、`context`（上下文查看）
- 📱 **多平台支持**：`frontend/{web,h5,miniapp}/` 目录结构，`.speccore/config/platforms.yaml`
- 🔧 **命令增强**：`execute` + `--platform`；`progress` + `--platform`；`import` + `--scope` / `--ignore` / `--update`
- 🧠 **意图识别升级**：31 种意图类型（新增 new_task / platform_add / index_update / context）
- 🤖 **WorkBuddy 集成**：`init` 自动创建 `.workbuddy/skills/speccore/SKILL.md`
- 📋 **命令总数**：39 个

### v3.0.0 (2026-07-05)

- 🌐 **多项目全量层**：GLOBAL/ 目录（INDEX / OVERVIEW / ARCHITECTURE / TECH_STACK / GLOSSARY 等）
- 🔗 **全链路可追溯**：需求 → Task → 代码双向追踪
- 📊 **P0/P1/P2 命令**：impact / baseline / dashboard / audit
- ✏️ **rename 命令**：重命名自动更新所有引用
- 📋 **命令总数**：35 个

### v2.0.0 (2026-07-05)

- 🧠 **意图识别引擎**：12 种意图，100+ 关键词
- 🚀 **新增**：spec / goal / bugfix / research / change / sync / handover / retro / template-add / help / demo / welcome
- 📋 **命令总数**：26 个

### v1.0.0 (2026-07-05)

- 🎉 初始版本
- 14 个核心命令：init / import / iteration create / iteration split / task new / plan / execute / validate / archive / progress / status / health / report / config
- 核心引擎：context / state / global-layer / yaml-parser / template-engine / validator
- 支持 JSON / Markdown / HTML 多格式输出

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/my-feature`
3. 提交更改：`git commit -m 'feat: add some feature'`
4. 推送分支：`git push origin feature/my-feature`
5. 创建 Pull Request

---

## License

[MIT](https://opensource.org/licenses/MIT)

---

<p align="center">Built with ❤️ by the SpecCore Team</p>
