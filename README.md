# SpecCore — Code by Spec, Not by Vibe

🖥️ 规范驱动开发 CLI · 21 简洁命令（55 全量）· 人机协同闭环 · 多层 AI 架构

```bash
speccore ask "我想做一个登录功能，计划晚8点分批执行"
```

---

## 架构概览

```
speccore ask ←── AI 万能入口 ──→ speccore dev (智能级联)
    │                                     │
    ├─ 📖 命令解释 "dashboard 怎么用"      ├─ 🏗️ 初始化
    ├─ 🗺️ 任务指引 "我想做登录"           ├─ 📝 导入需求
    ├─ 🎯 意图匹配 "查看进度"              ├─ 🧠 AI 分析
    └─ ⚡ 复杂编排 "计划→定时→分批"        ├─ 📦 拆分任务
                                          ├─ ⚡ 执行开发
    ┌─────────────────────────────┐        ├─ 🔀 提交 PR
    │  speccore dashboard         │        ├─ ✅ 归档收尾
    │  ─ 全局仪表盘 (7 大维度)     │        └─ 📊 生成回顾
    │  ─ 9 主题 / 中英文 / 字号   │
    │  ─ F 键全屏 / 四边扫描线    │
    └─────────────────────────────┘
```

## 快速开始

```bash
npm install -g speccore
speccore init                    # 初始化项目
speccore welcome                 # 查看项目名片
speccore ask "查看进度"          # AI 万能入口
speccore dev --auto              # 智能级联一键推进
```

## 核心流水线

```
init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc
                   └─ .issues.md ← 问题发现 ── → AI 辅助修复
                   └─ .needs-retry ← 失败标记 ── → execute --resume
```

## 21 简洁命令

| 分类 | 命令 |
|------|------|
| 入口 | `ask` `welcome` `init` `help` |
| 流水线 | `doc2spec` `analyze` `split` `plan` `execute` `pr` `done` `spec2doc` |
| 智能 | `dev` |
| 管理 | `iteration` `task` `change` |
| 查看 | `dashboard` `search` `validate` `retro` `ops` |

## 目录结构（全英文）

```
Iteration-001-meeting/          ← 会议系统（中文→slug: meeting）
├── 000-overview/               ← 进度跟踪
├── 010-requirements/           ← doc2spec 导入
│   ├── sources/                ← 原始 PRD/Word
│   ├── assets/                 ← 素材
│   │   ├── prd/                ← PRD 提取图片
│   │   ├── prototypes/         ← 产品原型
│   │   └── designs/            ← UI 设计稿
│   ├── app/                    ← APP 端需求
│   ├── h5/                     ← H5 端需求
│   ├── miniapp/                ← 小程序端需求
│   ├── admin/                  ← 管理后台需求
│   └── _shared/                ← 跨端通用规则
├── 020-specs/                  ← analyze 输出
│   ├── app/ANALYSIS.md
│   ├── h5/ANALYSIS.md
│   ├── miniapp/ANALYSIS.md
│   └── admin/ANALYSIS.md
├── 020-specs/            ← analyze 分端输出
│   ├── app/ANALYSIS.md
│   ├── h5/ANALYSIS.md
│   ├── miniapp/ANALYSIS.md
│   └── admin/ANALYSIS.md
├── 030-tasks/            ← 所有开发任务
│   └── Task-001-*/       ← split 拆分（含 .issues.md .needs-retry）
```

## 断点重试

```bash
speccore execute --all          # 全量执行
# 部分任务失败 → 写入 .issues.md + .needs-retry
speccore execute --resume       # 扫描 .needs-retry 续跑
```

## 批量回顾

```bash
speccore retro --all                     # 所有任务
speccore retro --all --owner 张三         # 按人
speccore retro --all --type bugfix        # 按类型
```

### 🧠 ask — AI 万能入口
4 种模式自动识别，无需记忆命令：
- **📖 命令解释**：`speccore ask "dashboard 怎么用"`
- **🗺️ 任务指引**：`speccore ask "我想做一个支付功能"` → 8 步全流程
- **🎯 意图匹配**：`speccore ask "查看进度"` → 自动匹配 dashboard
- **⚡ 复杂编排**：`speccore ask "计划任务，晚8点分批执行"` → plan→schedule→execute

### 📊 dashboard — 全局仪表盘
`speccore dashboard --scope global` 生成 Jira 标准 7 维度 HTML 看板：
- 需求状态分布（饼图）+ 项目需求分布（柱状图）+ Created vs Resolved
- 项目健康度评分 + 期次进度条 + 需求详情表（按期次倒序）
- 9 套主题、中英文切换、字体/字号调节、F 键全屏、四边脉冲扫描线

### 🔄 dev — 智能级联
自动检测项目阶段，一键推进：`speccore dev --auto`

### 🚀 全量流水线
| 阶段 | 命令 | AI 模式 |
|------|------|------|
| 导入需求 | `doc2spec -f PRD.docx` | 📖 命令解释 |
| AI 分析 | `analyze --audit` | 🗺️ 任务指引 |
| 拆分任务 | `split` | 🎯 意图匹配 |
| 执行计划 | `plan --all` | ⚡ 复杂编排 |
| 开发执行 | `execute --batch-size 3` | ⚡ 复杂编排 |
| 提交 PR | `pr --auto` | 🎯 意图匹配 |
| 归档收尾 | `done --all` | 🎯 意图匹配 |

## 安装 & 环境

```bash
npm install -g speccore
speccore --version   # v5.27.0
```

## 命令列表

| 命令 | 别名 | 功能 |
|------|------|------|
| `ask` | — | 🧠 万能 AI 入口（4 模式） |
| `welcome` | — | 🏷️ 项目名片 + 使用引导 |
| `dashboard` | `db` | 📊 期次/全局仪表盘 |
| `dev` | `d` | 🔄 智能级联流水线 |
| `init` | `in` | 🏗️ 项目初始化 |
| `doc2spec` | `d2s` | 📝 PRD→SpecCore MD |
| `spec2doc` | `s2d` | 📤 SpecCore MD→Word/PDF/HTML |
| `analyze` | `al` | 🧠 AI 需求分析 |
| `split` | — | 📦 需求拆分 |
| `plan` | `pl` | 📐 执行计划 |
| `execute` | `ex` | ⚡ 执行开发 |
| `pr` | `mr` | 🔀 Pull Request |
| `done` | `dn` | ✅ 归档收尾 |
| `change` | `ch` | 🔄 需求变更 |
| `sync` | `sy` | 🔄 双向同步 |
| `validate` | `vl` | ✅ 合规验证 |
| `track` | `trk` | 🔗 REQ→Task→Code 全链路 |
| `search` | `sh` | 🔍 跨 Spec 全文搜索 |
| `retro` | `rt` | 📝 任务回顾复盘 + 评分 |
| `rename` | `rn` | ✏️ 重命名 |
| `ops` | `op` | 📜 操作历史 |

## TTY 智能适配

所有 AI 命令 (`ask`, `welcome`, `dev`, `dashboard`, `help`) 自动检测环境：
- **终端**：Unicode 框线美化输出
- **AI 调用**：自动生成 Ocean 主题 HTML 页面（四边脉冲扫描线）

## 🤖 三层 AI 架构

```
speccore ask "..." / speccore dev
  ├─ 🧠 自有 LLM   → OpenAI / Ollama（SPECCORE_LLM_KEY 环境变量）
  ├─ 🤖 宿主 AI    → WorkBuddy / TRAE / Qoder（自动检测）
  └─ 📐 规则引擎   → 18 条命令 KB + 4 预定义工作流（永远可用）
```

零配置：没配 Key 自动降级，功能不受影响。

## 🎯 两种模式

| 模式 | 触发 | 命令数 | 适用场景 |
|------|------|:--:|------|
| **简洁模式**（默认） | `speccore --help` | 21 个 | 日常开发够用：init → ask → dev → done |
| **全量模式** | `speccore --help full` | 55+ 个 | 高级用户：子命令 + 工具 + 调试 |

```bash
speccore --help           # 简洁模式，日常高频命令
speccore --help full      # 全量模式，含所有子命令和工具
```

简洁模式 = 高信号比，只展示真正日常用到的。全量模式 = 一个不漏。

## 📖 文档

| 文档 | 说明 |
|------|------|
| [快速开始](docs/快速开始.md) | 5 分钟上手，安装 → 完整流程 |
| [命令参考](docs/命令参考.md) | 全部 21 命令 + 子命令 + 示例 |
| [总览](docs/总览.md) | 核心概念 + 工作流 + 三种使用方式 |
| [场景实战](docs/场景实战.md) | 35 个真实开发场景 |
| [SDD 方法论](docs/SDD方法论.md) | 规范驱动开发理念 |
| [工作空间组织](docs/工作空间组织.md) | 目录结构与文件规范 |
| [工具适配说明](docs/工具适配说明.md) | Qoder/TRAE 等 AI 工具集成 |
| [三层加载机制](docs/Spec三层加载机制.md) | GLOBAL/ITERATION/TASK 加载原理 |
| [CI-CD 集成](docs/CI-CD与spec注释集成指南.md) | CI/CD 流水线 + Spec 注释 |
| [迁移指南](docs/migration-guide.md) | 从旧版本升级 |
| [CHANGELOG](CHANGELOG.md) | 版本历史 |

## 许可

MIT © 2026 SpecCore Team
