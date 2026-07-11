# SpecCore

> **Code by Spec, Not by Vibe.**

[![npm version](https://img.shields.io/npm/v/speccore.svg)](https://www.npmjs.com/package/speccore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

SpecCore is a specification-driven development framework for AI-native teams. It decouples deterministic operations (file creation, directory management, format validation, status statistics) from AI, executing them directly through code to improve efficiency and reduce Token consumption.

> 💡 **v4.0.0** | 39 Commands | 31 Intent Types | Multi-Platform

---

## 🧩 Two Ways to Use

SpecCore has two distinct parts:

| | 🔧 Terminal (CLI) | 🤖 AI Commands (Slash) |
| :--- | :--- | :--- |
| **Where** | Terminal | AI coding tools (WorkBuddy / Cursor / Claude) |
| **How** | `speccore init` | Type `/spec-xxx` |
| **Mechanism** | TypeScript, direct file ops | Markdown prompts, AI reads & executes |
| **Count** | 39 CLI commands | 39 Slash Commands |
| **When** | Init, validation, batch ops | Daily dev: iteration, execution, review, archive |

> 💡 **Remember**: `speccore` prefix → Terminal; `/spec` prefix → AI tool.

---

## 📦 Install

```bash
npm install -g speccore          # Global install (recommended)
npx speccore --version           # Or use npx
```

---

## 🚀 Quick Start (5 min)

```bash
# 1. Initialize
cd my-project && speccore init

# 2. Import to global layer
speccore import --project=user-service --path=./backend --type=backend

# 3. Create iteration
speccore iteration create --name 2026-07-UserSystem

# 4. Multi-platform task
speccore new-task --name UserLogin --platforms=web,h5

# 5. Smart entry
speccore spec "How's the progress?"
```

> 📚 See [Quick Start Guide](docs/quick-start.en.md) for detailed steps.

---

## Feature Highlights

- **🚀 Quick Init**: One command initializes the full project structure, auto-integrates WorkBuddy
- **📱 Multi-Platform**: `--platforms=web,h5,miniapp` per-platform Task management, dynamic platform types
- **🧠 Intent Recognition**: 31 intent types, 200+ keywords, natural language → command matching
- **🌐 Global Layer**: Cross-project requirement indexing via GLOBAL/ architecture
- **📊 Progress Tracking**: Auto-detect active iteration, per-platform/per-assignee stats
- **✅ Auto Compliance**: Scan all Spec files, check required fields and format
- **🔄 Deterministic Execution**: File ops, validation, statistics — all local code, zero Token cost

---

## Design Philosophy

SpecCore decouples **deterministic logic from intelligent logic**:

| Logic Type | Responsibility | Executor | Example |
| :--- | :--- | :--- | :--- |
| **Deterministic** | Structured operations | CLI code | Create dirs, parse YAML, validate, count |
| **Intelligent** | Understanding & decision | AI tool | Understand requirements, split tasks, generate code |

```
User Input (Natural Language / Slash Command)
        │
        ▼
┌───────────────────────────────────────┐
│   AI Layer (Intelligent Decision)     │
│   - Understand user intent            │
│   - Decide which operations to run    │
│   - Generate code content             │
└───────────────────────────────────────┘
        │ Call CLI commands
        ▼
┌───────────────────────────────────────┐
│   CLI Layer (Deterministic Execution) │
│   - Create directory structure        │
│   - Read/write config & Spec files    │
│   - Parse YAML                        │
│   - Compliance validation             │
│   - Output structured results         │
└───────────────────────────────────────┘
```

---

## 🔧 CLI Commands Quick Reference (39 total)

> Run in terminal. All commands start with `speccore`.

| Category | Key Commands |
| :--- | :--- |
| 🧠 Smart Entry | `speccore spec "<query>"` |
| 🌐 Global Layer | `import` / `iteration-from-global` / `sync-global` / `global-status` / `history` / `index-update` |
| 📋 Scenario | `goal` / `bugfix` / `research` / `retro` / `handover` |
| 📐 Planning | `init` / `iteration create` / `iteration split` / `new-task` / `plan` |
| ⚡ Execution | `execute` (--platform / --priority / --status) |
| 🔄 Change | `change` / `sync` / `sync-global` |
| ✅ Review | `validate` (--fix) |
| 📊 Progress | `progress` (--platform / --detail) / `status` |
| 📦 Management | `archive` / `config` / `baseline` / `rename` |
| 🔗 Analysis | `impact` / `dashboard` / `audit` |
| 📱 Platform | `platform-add` / `context` |
| 🛠️ Tools | `health` / `report` / `template-add` / `help` / `demo` / `welcome` |

## 🤖 AI Commands (Slash Command) Mapping

> Type `/` in AI tools (WorkBuddy / Cursor / Claude Code etc.). AI commands call the corresponding CLI command internally.

| CLI Command | AI Slash Command | Purpose |
| :--- | :--- | :--- |
| `speccore init` | `/spec-init` | Initialize project |
| `speccore import` | `/spec-import` | Import to global layer |
| `speccore iteration create` | `/spec-iteration-create` | Create iteration |
| `speccore new-task` | `/spec-new-task` | Create multi-platform task |
| `speccore execute` | `/spec-execute` | Execute development |
| `speccore progress` | `/spec-progress` | View progress |
| `speccore validate` | `/spec-validate` | Compliance check |
| `speccore impact` | `/spec-impact` | Impact analysis |
| `speccore audit` | `/spec-ai-audit` | AI smart audit |
| `speccore spec "query"` | `/spec query` | Natural language intent |

> 📋 Full command reference: [Command Reference](docs/commands.en.md) | 🧠 Intent mapping: [Intent Map](docs/commands.en.md#natural-language-intent-mapping-31-types)

---

## 🏗️ Architecture

```
.speccore/GLOBAL/   ← Global Layer: unified multi-project requirements
.speccore/           ← Project Layer: constitution, config, patterns
Iteration-XXX/       ← Iteration Layer: what this iteration does
  └── Task-XXX/      ← Task Layer: how this feature works
      ├── _shared/   ← Shared: API Contract + business rules
      ├── backend/   ← Backend Specs
      └── frontend/  ← Multi-platform frontend specs (web / h5 / miniapp)
```

---

## 🛠️ Tool Support

| CN | Global |
| :--- | :--- |
| WorkBuddy / Qcoder / Trae | Cursor / Claude Code / Windsurf / Gemini CLI / OpenCode |

SpecCore natively integrates WorkBuddy.

> 📚 See [Tool Adaptation](docs/tool-adaptation.en.md)

---

## 📚 Documentation

| Document | Lang | Content |
| :--- | :--- | :--- |
| [SDD Methodology](docs/sdd-methodology.en.md) | 🇬🇧 | What is SDD, why, how |
| [Quick Reference](docs/quick-reference.en.md) | 🇬🇧 | One-page: commands + safety rules + CI |
| [Quick Start](docs/quick-start.en.md) | 🇬🇧 | Install → Init → Import → Multi-platform → Scenarios |
| [Command Reference](docs/commands.en.md) | 🇬🇧 | 44 commands full params + 31 intents + aliases |
| [Tool Adaptation](docs/tool-adaptation.en.md) | 🇬🇧 | WorkBuddy integration + workflow + security |
| [Usage Guide](docs/usage-guide.en.md) | 🇬🇧 | File safety: what to edit manually vs via command |
| [Workspace Layout](docs/workspace-organization.en.md) | 🇬🇧 | Recommended directory structure + multi-project workflow |
| [Migration Guide](docs/migration-guide.en.md) | 🇬🇧 | Shell v3.x → CLI v5.x |
| [SDD 方法论](docs/SDD方法论.md) | 🇨🇳 | SDD 是什么、为什么、怎么做 |
| [速查卡](docs/速查卡.md) | 🇨🇳 | 一页掌握：常用命令 + 安全口诀 + CI |
| [快速开始指南](docs/快速开始.md) | 🇨🇳 | 安装 → 初始化 → 导入 → 多端 Task → 场景速查 |
| [命令参考手册](docs/命令参考.md) | 🇨🇳 | 44 个命令完整参数 + 31 种意图映射 + 别名速查 |
| [工具适配说明](docs/工具适配说明.md) | 🇨🇳 | WorkBuddy 集成原理 + 工作流程 + 安全检查 |
| [使用指南](docs/使用指南.md) | 🇨🇳 | 文件操作安全指南 |
| [工作空间组织](docs/工作空间组织.md) | 🇨🇳 | 推荐目录结构 + 多工程协作 |
| [迁移指南](docs/migration-guide.md) | 🇨🇳 | Shell v3.x → CLI v5.x |
| [CHANGELOG](CHANGELOG.md) | 🇨🇳 | Version history (v1.0.0 → v5.3.0) |
| [README.md](README.md) | 🇨🇳 | 中文项目概述 |

---

## FAQ

| Q | A |
| :--- | :--- |
| **Command not found?** | Add npm bin to PATH: `export PATH="$(npm bin -g):$PATH"` |
| **How to update?** | `npm update -g speccore` |
| **Same feature on Web+H5+MiniApp?** | `speccore new-task --platforms=web,h5,miniapp` |
| **Add new platform?** | `speccore platform-add --name=tablet --tech="React Native"` |
| **Rename iteration/task?** | `speccore rename --target=old --new-name=new` |
| **Batch rename?** | `speccore rename --batch --pattern="Task-" --replacement="Feature-"` |
| **Rebuild requirement index?** | `speccore index-update` (--dry-run to preview) |

| **Which files are safe to edit manually?** | See [Usage Guide](docs/使用指南.md). TL;DR: `REQ.md`/`TECH.md` safe; `API_CONTRACT.yaml`/`.json` require CLI commands. |

---

## File Safety Quick Reference

| Zone | Files | Rule |
| :--- | :--- | :--- |
| ✅ Safe | `REQ.md`, `TECH.md`, `GLOSSARY.md`, `*.md` comments | Edit directly, then `speccore sync --reverse` |
| ❌ Danger | `PROJECT_GRAPH.md` tables, `.task-type`, `API_CONTRACT.yaml`, `.json` data | Use `speccore` commands instead |
| ⚠️ Caution | `GLOBAL/REQUIREMENT.md`, `CHANGELOG.md` | Edit then immediately run `speccore sync-global` |

---

## Development

```bash
git clone https://github.com/windfallsheng/SpecCore-ts.git
cd SpecCore-ts/ts-cli
npm install && npm run build
npm run watch           # Dev mode
npm link && speccore --version   # Local test
bash verify.sh          # Run tests
```

---

## Version

v4.6.0 | 🔧 CLI Commands: 40 | 🧠 Intents: 31

Changelog: [CHANGELOG.md](CHANGELOG.md)

---

## License

[MIT](https://opensource.org/licenses/MIT)

---

<p align="center">Built with ❤️ by the SpecCore Team</p>
