# SpecCore CLI

> **Code by Spec, Not by Vibe.**

[![npm version](https://img.shields.io/npm/v/speccore.svg)](https://www.npmjs.com/package/speccore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

SpecCore CLI 是 [SpecCore](https://github.com/spec-core/spec-core) 规范驱动开发框架的官方命令行工具。它将确定性操作（文件创建、目录管理、格式校验、状态统计）从 AI 中剥离，由代码直接执行，提升效率并降低 Token 消耗。

---

## 一分钟了解

| 问题 | 答案 |
| :--- | :--- |
| **这是什么？** | SpecCore 框架的 CLI 工具，确定性操作由代码执行，智能决策由 AI 负责 |
| **解决什么问题？** | AI 做文件操作容易出错、Token 消耗高、上下文窗口浪费 |
| **需要安装什么？** | Node.js >= 18，执行 `npm install -g speccore` |
| **和 Slash Command 的关系？** | CLI 是 Slash Command 的底层执行引擎，AI 负责决策，CLI 负责执行 |

---

## 特性亮点

- **🚀 快速初始化**：一行命令初始化完整的 SpecCore 项目结构
- **📁 智能目录管理**：自动创建期次、任务、共享资源目录，符合规范
- **✅ 自动合规检查**：扫描所有 Spec 文件，检查必填项和格式
- **📊 实时进度追踪**：自动识别活跃期次，统计任务完成率
- **🏥 健康度看板**：4 维度 12 指标评估项目健康状态
- **📈 一键报告**：支持 Markdown/HTML/JSON 格式输出项目报告
- **🧠 上下文感知**：自动读取 `.speccore/local/context.json`，智能填充默认值
- **🔄 确定性执行**：文件操作、格式校验、状态统计全部本地代码执行，零 Token 消耗

---

## 设计理念

SpecCore 采用**确定性逻辑与智能逻辑解耦**的架构：

| 逻辑类型 | 职责 | 执行方 | 示例 |
| :--- | :--- | :--- | :--- |
| **确定性逻辑** | 结构化操作 | CLI 代码 | 创建目录、移动文件、解析 YAML、校验格式、统计状态 |
| **智能逻辑** | 理解与决策 | AI | 理解需求、拆分任务、生成代码、审查产出 |

```
用户输入 (Slash Command)
        │
        ▼
┌───────────────────────────────────────┐
│   AI 层 (智能决策)                     │
│   - 理解用户意图                       │
│   - 决定执行哪些操作                   │
│   - 生成代码内容                       │
└───────────────────────────────────────┘
        │ 调用 CLI 命令
        ▼
┌───────────────────────────────────────┐
│   CLI 层 (确定性执行)                  │
│   - 创建目录结构                       │
│   - 读写文件                           │
│   - 解析 YAML                          │
│   - 校验格式                           │
│   - 输出 JSON 结果                     │
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

# 或安装指定版本
npm install -g speccore@1.0.0
```

---

## 快速开始

### 1. 初始化项目

```bash
# 进入你的项目目录
cd my-project

# 初始化 SpecCore
speccore init --mode fresh

# 或迁移现有项目
speccore init --mode migration
```

执行后，当前目录会生成：

```
.speccore/                          # 全局配置目录
├── CONSTITUTION.md                 # 技术宪法（定义技术栈、规范）
├── SETTINGS.md                     # 框架配置（开关、模式）
├── ITERATIONS/                     # 期次记录
├── PATTERNS/                       # 模式库
├── PROJECT/                        # 项目级资产
│   ├── OVERVIEW.md
│   ├── TEAM.md
│   └── ...
├── RULES/                          # 裁决规则
└── local/                          # 本地状态
    └── context.json                # 当前上下文（期次、任务、用户）
```

### 2. 创建期次

```bash
speccore iteration create --name 2026-07-用户系统
```

生成 `期次-2026-07-用户系统/` 目录，包含：
- `00-需求文档/REQUIREMENT.md`
- `00-技术文档/ARCHITECTURE.md`
- `00-期次总览/PROJECT_GRAPH.md`

### 3. 创建任务

```bash
speccore task new --name 用户登录 --type feature
speccore task new --name 手机号注册 --type feature
speccore task new --name 密码重置 --type bugfix
```

### 4. 查看进度

```bash
# 查看整体进度
speccore progress

# JSON 格式输出（适合 CI/CD）
speccore progress --format json

# 查看详细进度
speccore progress --detail
```

### 5. 验证合规性

```bash
# 验证所有任务
speccore validate

# 自动修复可修复的问题
speccore validate --fix

# JSON 格式输出（AI 可直接读取）
speccore validate --format json
```

### 6. 生成报告

```bash
# Markdown 格式（默认）
speccore report

# HTML 格式（适合邮件发送）
speccore report --format html --output ./report.html

# JSON 格式（适合导入其他系统）
speccore report --format json

# 包含团队分析和风险分析
speccore report --team --risk
```

---

## 完整命令列表

### 初始化与导入

| 命令 | 说明 | 对应 Slash Command | 确定性 |
| :--- | :--- | :--- | :--- |
| `speccore init` | 初始化 SpecCore 项目 | `/spec-init` | ✅ |
| `speccore import` | 导入现有项目 | `/spec-import` | ✅ |

### 期次管理

| 命令 | 说明 | 对应 Slash Command | 确定性 |
| :--- | :--- | :--- | :--- |
| `speccore iteration create` | 创建期次 | `/spec-iteration-create` | ✅ |
| `speccore iteration split` | 需求拆分（需 AI 传入任务列表） | `/spec-iteration-split` | ⚠️ |

### 任务管理

| 命令 | 说明 | 对应 Slash Command | 确定性 |
| :--- | :--- | :--- | :--- |
| `speccore task new` | 创建原子任务 | `/spec-new-task` | ✅ |

### 执行与调度

| 命令 | 说明 | 对应 Slash Command | 确定性 |
| :--- | :--- | :--- | :--- |
| `speccore plan` | 生成调度方案（DAG 分析） | `/spec-plan` | ✅ |
| `speccore execute` | 执行任务（需 AI 协同） | `/spec-execute` | ⚠️ |

### 验证与审查

| 命令 | 说明 | 对应 Slash Command | 确定性 |
| :--- | :--- | :--- | :--- |
| `speccore validate` | 合规性检查 | `/spec-validate` | ✅ |
| `speccore progress` | 进度查看 | `/spec-progress` | ✅ |
| `speccore status` | 项目状态 | `/spec-status` | ✅ |
| `speccore health` | 健康度看板（4维度12指标） | `/spec-health` | ✅ |
| `speccore report` | 生成项目报告 | `/spec-report` | ✅ |

### 归档与配置

| 命令 | 说明 | 对应 Slash Command | 确定性 |
| :--- | :--- | :--- | :--- |
| `speccore archive` | 归档任务 | `/spec-archive` | ✅ |
| `speccore config` | 配置管理 | `/spec-config` | ✅ |

- **✅** 纯确定性逻辑，可完全由代码执行
- **⚠️** 需要 AI 参与理解/生成（如需求拆分、代码生成）

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
│   ├── index.ts                    # 入口文件
│   ├── cli.ts                      # CLI 命令注册（Commander.js）
│   │
│   ├── commands/                   # 所有 CLI 命令实现
│   │   ├── init.ts                 # 初始化项目
│   │   ├── import.ts               # 导入现有项目
│   │   ├── iteration/
│   │   │   ├── create.ts           # 创建期次
│   │   │   └── split.ts            # 需求拆分
│   │   ├── task/
│   │   │   └── new.ts              # 创建任务
│   │   ├── plan.ts                 # 生成调度方案
│   │   ├── execute.ts              # 执行任务
│   │   ├── validate.ts             # 合规性检查
│   │   ├── archive.ts              # 归档任务
│   │   ├── progress.ts             # 进度查看
│   │   ├── status.ts               # 项目状态
│   │   ├── health.ts               # 健康度看板
│   │   ├── report.ts               # 生成报告
│   │   └── config.ts               # 配置管理
│   │
│   ├── core/                       # 核心引擎
│   │   ├── context.ts              # 上下文管理（读取 context.json）
│   │   ├── state.ts                # 状态管理（读取 PROJECT_GRAPH.md）
│   │   ├── yaml-parser.ts          # YAML 解析
│   │   ├── template-engine.ts      # 模板渲染（Handlebars）
│   │   └── validator.ts            # 合规性检查引擎
│   │
│   ├── templates/                  # 内置模板
│   │   ├── spec/                   # Spec 文件模板
│   │   │   └── project-readme.md
│   │   └── code/                   # 代码生成模板
│   │       ├── spring-controller.java
│   │       ├── spring-service.java
│   │       ├── spring-test.java
│   │       └── nest-controller.ts
│   │
│   └── utils/
│       ├── file.ts                 # 文件工具
│       ├── git.ts                  # Git 工具（获取用户名等）
│       └── logger.ts               # 日志输出（含进度条、Spinner）
│
└── dist/                           # 编译输出（TypeScript → JavaScript）
```

---

## 开发指南

```bash
# 克隆仓库
git clone https://github.com/spec-core/speccore.git
cd speccore

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 开发模式（监听文件变化自动编译）
npm run watch

# 本地测试
node bin/speccore --version

# 链接到全局（开发测试）
npm link
speccore --version
```

---

## 常见问题

### Q: 安装后命令找不到？

A: 确保 npm 全局 bin 目录在 PATH 中：

```bash
# 查看全局安装路径
npm bin -g

# 添加到 PATH（macOS/Linux）
export PATH="$(npm bin -g):$PATH"
```

### Q: 如何更新到最新版本？

```bash
npm update -g speccore
```

### Q: 如何卸载？

```bash
npm uninstall -g speccore
```

### Q: 与 AI 工具如何配合？

A: AI 工具（如 WorkBuddy）通过调用 CLI 命令来执行确定性操作。例如：

```bash
# AI 执行 /spec-validate 时，内部调用：
speccore validate --json

# AI 读取 JSON 结果，生成用户友好的中文报告
```

---

## 相关项目

| 项目 | 说明 | GitHub | Gitee |
| :--- | :--- | :--- | :--- |
| **SpecCore** | 规范驱动开发框架（方法论 + 文件模板 + Slash Commands） | [windfallsheng/SpecCore](https://github.com/windfallsheng/SpecCore) | [windfullsheng/spec-core](https://gitee.com/windfullsheng/spec-core) |
| **SpecCore CLI** | CLI 工具（确定性操作执行引擎） | [windfallsheng/SpecCore-ts](https://github.com/windfallsheng/SpecCore-ts) | [windfullsheng/spec-core-ts](https://gitee.com/windfullsheng/spec-core-ts) |

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/my-feature`
3. 提交更改：`git commit -m 'feat: add some feature'`
4. 推送分支：`git push origin feature/my-feature`
5. 创建 Pull Request

---

## 更新日志

### v1.0.0 (2026-07-05)

- 初始版本发布
- 支持 14 个 CLI 命令
- 核心引擎：上下文管理、状态管理、YAML 解析、模板渲染、合规检查
- 内置模板：Spring Boot Controller/Service/Test、NestJS Controller
- 支持 JSON/Markdown/HTML 多格式输出

---

## License

[MIT](https://opensource.org/licenses/MIT)

---

<p align="center">Built with ❤️ by the SpecCore Team</p>
