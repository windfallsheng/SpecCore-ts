# SpecCore

> **Code by Spec, Not by Vibe.**

[![npm version](https://img.shields.io/npm/v/speccore.svg)](https://www.npmjs.com/package/speccore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

SpecCore 是一套可落地的、面向 AI 原生团队的规范驱动研发工程框架。它将确定性操作（文件创建、目录管理、格式校验、状态统计）从 AI 中剥离，由代码直接执行，提升效率并降低 Token 消耗。

---

## 🧩 两种使用方式

SpecCore 由两部分组成，**职责明确，互不混淆**：

| | 🔧 终端命令（CLI） | 🤖 AI 命令（Slash Command） |
| :--- | :--- | :--- |
| **在哪里执行** | 终端 / Terminal | AI 编程工具（WorkBuddy / Cursor / Claude 等） |
| **怎么用** | `speccore init` | 输入 `/spec-xxx` |
| **什么原理** | TypeScript 编译，直接操作文件 | Markdown 指令，AI 读取后执行 |
| **数量** | 68 个 CLI 命令 | 54 个 Slash Command |
| **何时用** | 项目初始化、文件校验、批量操作 | 日常开发：需求管理、开发执行、审查归档 |

> 💡 **简单记忆**：`speccore` 开头 → 终端执行；`/spec` 开头 → AI 工具中执行。

---

## 📦 安装

```bash
npm install -g speccore          # 全局安装（推荐）
npx speccore --version           # 或使用 npx
```

---

## 🚀 快速开始（5 分钟）

```bash
# 1. 初始化项目
cd my-project && speccore init

# 2. 导入项目到全量层
speccore import --project=user-service --path=./backend --type=backend

# 3. 创建期次
speccore iteration create --name 2026-07-用户系统

# 4. 创建多平台 Task
speccore new-task --name 用户登录 --platforms=web,h5

# 5. 自然语言入口
speccore spec "进度怎么样了"
```

> 📚 更多场景和详细步骤见 [快速开始指南](docs/快速开始.md)

---

## 特性亮点

- **🚀 快速初始化**：一行命令初始化完整 SpecCore 项目结构，自动集成 WorkBuddy
- **📱 多平台支持**：`--platforms=web,h5,miniapp` 按端管理 Task，动态添加平台类型
- **🧠 意图识别引擎**：38 种意图类型，200+ 关键词，自然语言自动匹配命令
- **🌐 多项目全量层**：GLOBAL/ 统一管理跨项目需求索引、架构和技术栈
- **📊 实时进度追踪**：自动识别活跃期次，统计任务完成率，按平台/人员/类型统计
- **✅ 自动合规检查**：扫描所有 Spec 文件，检查必填项和格式
- **🏥 项目健康度**：4 维度 12 指标评估项目健康状态
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

---

## 🔧 终端命令速查（68 个 CLI 命令）

> 在终端中执行，所有命令以 `speccore` 开头。

| 分类 | 命令 | 说明 |
| :--- | :--- | :--- |
| 🧠 智能入口 | `speccore spec "<query>"` | 自然语言意图识别 |
| 🌐 初始化/导入 | `speccore init` / `import` / `word2spec` | 项目初始化 + 多项目导入 + Word 需求导入 |
| 📐 计划 | `speccore iteration create/split` / `new-task` / `plan` | 期次管理 + Task 创建 |
| | `speccore iteration-from-global` | 从全量层生成期次 |
| ⚡ 执行 | `speccore execute` | 执行控制中心（--platform / --priority） |
| 🔄 变更 | `speccore change` / `sync` / `sync-global` | 需求变更 + 反向同步 + 全量同步 |
| ✅ 审查 | `speccore validate` | 合规性检查（--fix） |
| 📊 进度 | `speccore progress` / `status` | 进度总览（--platform / --detail） |
| 🔬 分析 | `speccore impact` / `baseline` / `dashboard` / `audit` | 影响分析 + 基线 + 仪表盘 + 审计 |
| 🌐 全量层 | `speccore global-status` / `history` / `index-update` | 全量状态 + 历史 + 索引更新 |
| 📱 平台 | `speccore platform-add` / `context` | 动态平台 + 上下文查看 |
| 🎯 场景 | `speccore goal` / `bugfix` / `research` / `handover` / `retro` | 端到端需求 + Bug + 调研 + 交接 + 回顾 |
| 🛠️ 工具 | `speccore health` / `report` / `archive` / `config` / `rename` / `template-add` / `help` / `demo` / `welcome` | 健康度 + 报告 + 归档 + 配置 + 重命名等 |

## 🤖 AI 命令（Slash Command）对应关系

> 在 AI 工具（WorkBuddy / Cursor / Claude Code 等）中输入 `/` + 命令。AI 命令在底层调用对应的 CLI 命令执行。68 个 CLI 命令都有对应的 `/spec-*` 形式。

| CLI 终端命令 | AI Slash Command | 用途 |
| :--- | :--- | :--- |
| `speccore init` | `/spec-init` | 项目初始化 |
| `speccore import` | `/spec-import` | 导入项目到全量层 |
| `speccore word2spec` | `/spec-word2spec` | Word 文档导入 |
| `speccore iteration create` | `/spec-iteration-create` | 创建期次 |
| `speccore iteration split` | `/spec-iteration-split` | 拆分需求为 Task |
| `speccore new-task` | `/spec-new-task` | 创建多平台 Task |
| `speccore execute` | `/spec-execute` | 执行开发任务 |
| `speccore change` | `/spec-change` | 需求变更 |
| `speccore sync` | `/spec-sync` | Spec-代码同步 |
| `speccore validate` | `/spec-validate` | 合规性检查 |
| `speccore archive` | `/spec-archive` | 归档任务 |
| `speccore rollback` | `/spec-rollback` | 从备份恢复 |
| `speccore dashboard` | `/spec-dashboard` | 仪表盘总览 |
| `speccore audit` | `/spec-ai-audit` | AI 智能审计 |
| `speccore spec "查询"` | `/spec 查询` | 自然语言智能入口 |

> 📋 完整命令参数见 [命令参考手册](docs/命令参考.md) | 🧠 38 种意图映射见 [意图映射表](docs/命令参考.md#自然语言意图映射36-种)

---

## 🏗️ 架构

```
.speccore/GLOBAL/   ← 全量层：多项目统一需求管理
.speccore/           ← 全局层：项目宪法、配置、模式
期次-XXX/            ← 期次层：这一期做什么
  └── Task-XXX/      ← 任务层：这个功能怎么做
      ├── _shared/   ← 共享层：API Contract + 业务规则
      ├── backend/   ← 后端 Spec
      └── frontend/  ← 前端多端 Spec（web / h5 / miniapp）
```

---

## 🛠️ 工具适配

| 国内 | 国际 |
| :--- | :--- |
| WorkBuddy / Qcoder / Trae | Cursor / Claude Code / Windsurf / Gemini CLI / OpenCode |

SpecCore 原生集成 WorkBuddy（`speccore init` 自动创建 `.workbuddy/` skill 和 memory）。

> 📚 完整适配说明见 [工具适配说明](docs/工具适配说明.md)

---

## 📚 文档

| 文档 | 内容 |
| :--- | :--- |
| 📊 [**总览**](docs/总览.md) | **命令地图 + 工作流全景 + 理念图解 + 8框架横评** |
| [快速开始指南](docs/快速开始.md) | 安装 → 7 步核心流程 → 命令速查 |
| [场景实战](docs/场景实战.md) | 37 个真实场景：从零启动→PR→回滚→选型 |
| [命令参考手册](docs/命令参考.md) | 全部命令完整参数 |
| [SDD 方法论](docs/SDD方法论.md) | SDD 是什么、为什么、怎么做 |
| [工具适配说明](docs/工具适配说明.md) | WorkBuddy 集成原理 + 安全检查 |
| [工作空间组织](docs/工作空间组织.md) | 推荐目录结构 + 多工程协作 |
| [迁移指南](docs/migration-guide.md) | Shell v3.x → CLI v5.x 迁移 |
| [CI/CD 集成](docs/CI-CD与spec注释集成指南.md) | @spec 注释 + GitHub Actions |
| [Spec 加载机制](docs/Spec三层加载机制.md) | 三层 Spec 协同 |
| [示例项目](examples/task-management/README.md) | 完整演示：需求→Spec→生成代码 |
| [CHANGELOG](CHANGELOG.md) | 版本历史（v1.0.0 → v5.18.0） |
| [README.en.md](README.en.md) | English project overview |

---

## 常见问题

| 问题 | 答案 |
| :--- | :--- |
| **安装后命令找不到？** | 确保 npm bin 目录在 PATH 中：`export PATH="$(npm bin -g):$PATH"` |
| **如何更新？** | `npm update -g speccore` |
| **同一个功能多端怎么管理？** | `speccore new-task --platforms=web,h5,miniapp`，按端执行和统计 |
| **如何添加新平台？** | `speccore platform-add --name=tablet --tech="React Native"` |
| **期次/Task 想改名？** | `speccore rename --target=旧名 --new-name=新名` |
| **批量重命名？** | `speccore rename --batch --pattern="Task-" --replacement="Feature-"` |
| **手动改了文档，需要同步？** | `speccore sync --task=Task-001` 或 `speccore sync-global` |
| **需求编号重复？** | `speccore validate --fix` 自动检测修复 |
| **如何重建需求索引？** | `speccore index-update`（--dry-run 预览） |
| **哪些文件可以手动改？** | 见下方 [文件操作安全指南](#文件操作安全指南) |

---

## 文件操作安全指南

SpecCore 不禁止手动编辑文件，但不同文件的安全级别不同。

### ✅ 安全区 — 可以直接手动改

这些文件是"描述性文字"，CLI 不会覆盖它们：

| 文件 | 内容 | 改完后 |
| :--- | :--- | :--- |
| `REQ.md` | 需求描述、背景、业务规则 | `speccore sync --reverse --task=xxx` 回写数据库 |
| `TECH.md` | 技术方案描述、设计思路 | 直接改即可，无需同步 |
| `GLOSSARY.md` | 术语定义 | `speccore sync --reverse` 更新索引 |
| `*.md` 注释行 | 备注、TODO、注意事项 | 不影响任何流程 |

### ❌ 高风险区 — 必须用命令修改

这些文件是"元数据/状态/关系"，手动改会被 CLI 覆盖或导致解析失败：

| 文件 | 错改后果 | 正确方式 |
| :--- | :--- | :--- |
| `PROJECT_GRAPH.md` 表格 | CLI 执行时直接覆盖 | `speccore plan --assign=张三` |
| `.task-type` | 类型错误影响整个生命周期 | `speccore new-task --type=feature` |
| `API_CONTRACT.yaml` | 缩进错误导致校验失败 | 编辑后用 `speccore validate` 验证 |
| `.speccore/data/*.json` | Zod 枚举拼写错误导致卡死 | `speccore change Task-001 "描述"` |

### ⚠️ 慎改区 — 手动改完必须立即同步

| 文件 | 正确流程 |
| :--- | :--- |
| `GLOBAL/REQUIREMENT.md` | 改完立即 `speccore sync-global` |
| `CHANGELOG.md` | 建议用 `speccore change` 自动追加 |



---

## 开发指南

```bash
# 克隆仓库
git clone https://github.com/windfallsheng/SpecCore-ts.git
cd SpecCore-ts/ts-cli

# 安装依赖 + 编译
npm install && npm run build

# 开发模式
npm run watch

# 本地测试
npm link && speccore --version

# 运行验证脚本
bash verify.sh
```

---

## 版本

v5.18.0 | 🔧 CLI 命令 68 个 | 🧠 意图识别 38 种

版本历史见 [CHANGELOG.md](CHANGELOG.md)

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
