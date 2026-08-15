# Spec 多层加载机制说明

> 适用版本：v6.15.x+

> 💡 **命令类型**: 本文档中的 `speccore execute` 为 🔒 AI 命令，需在 AI IDE 中通过 `@spec-ask` 使用。详见 [快速开始](quick-start.md)。

## 多层 Spec 架构

SpecCore 生成的所有 Spec 文件分为多个层次：**全局知识库**（analyze --full 自动生成）、**全局约束**（init 时配置）、**期次上下文**（迭代级文档）、**Task 执行**（任务级输入）。

```
Layer 0 — 全局知识库（analyze --full 自动生成 + 智能注入）
  🤖 GLOBAL/platforms/{端}/ → Phase 1 逐端分析
  🤖 GLOBAL/synthesis/      → Phase 2 跨端综合
  🤖 GLOBAL/INDEX.md         → Phase 2 后自动生成的轻量索引
  ✅ split/execute/analyze   → 必读注入 + TOC 目录，AI 自主 Read

Layer 1 — 全局约束（execute 自动解析）
  ✅ CONSTITUTION.md  spec-rule 区块 → 代码规范自动生效
  ✅ TECH_STACK.md    tech-stack 区块 → 技术栈自动检测

Layer 2 — 期次上下文（人类文档，手动查阅）
  📖 010-requirements/  本期需求总览
  📖 020-specs/         架构决策、技术分析

Layer 3 — Task 执行（execute 核心输入）
  ✅ Task/REQ.md      需求文档（接口表格解析 ✓）
  ✅ Task/TECH.md     技术方案
  ✅ Task/TASK.md     任务分解（状态更新 ✓）
```

## 一、Layer 0：全局知识库（analyze --full 自动生成 + 智能注入）

### 三阶段全自动流水线

```
Phase 1: 逐端分析
  CLI 读源码 → AI 按端类型生成专业分析 → 写入 GLOBAL/platforms/{端}/
  端类型自动识别：后端 / Web管理端 / 移动H5 / 小程序 / 原生App
  通用 10 维度 + 端专属专业维度

Phase 2: 跨端综合
  CLI 读 Phase 1 结果 → AI 生成三份综合文档 → 写入 GLOBAL/synthesis/
  - CROSS_PLATFORM.md — 跨端业务关系图
  - ARCHITECTURE.md  — 全量系统架构 + ADR + 安全架构
  - TECH_FULL.md     — 全量技术方案 + 容量规划
  完成后自动生成 GLOBAL/INDEX.md 轻量索引

Phase 3: 功能单元合成
  CLI 读 Phase 2 结果 → AI 按功能单元拆分 → 写入迭代级 010-requirements/
  每个功能单元含：用户故事 + 各端需求 + 接口汇总 + 数据字典 + 测试要点
```

### 智能上下文注入（核心机制）

**设计理念：CLI 给地图 + 标必读物，AI 自己看目录决定读哪些文件。**

TOC 目录覆盖 6 个来源：

| 分组 | 来源 | 用途 | AI 何时参考 |
|:---|:---|:---|:---|
| 📚 跨端综合文档 | GLOBAL/synthesis/ | 架构、技术方案、跨端关系 | execute 生成代码时参考架构约束 |
| 📱 各端分析文档 | GLOBAL/platforms/ | 各端专业分析 | execute 开发特定端时参考 |
| 🏗 工程级文档 | GLOBAL/PROJECTS/ | 逐工程分析 | execute 开发特定工程时参考 |
| 📖 参考文档 | GLOBAL/*.md | 术语、代码索引、全景、技术栈 | 任何命令需要项目上下文时 |
| ✏️ 写作模板 | PATTERNS/TEMPLATES/ | Spec 文档写作模板 | analyze 写 Spec 时参考格式 |
| 📏 规则与检查清单 | RULES/ | 代码审查、完成检查 | execute/done 时参考 |

```
analyze --full Phase 2 完成后
├── 写入 GLOBAL/synthesis/（CROSS_PLATFORM + ARCHITECTURE + TECH_FULL）
├── 写入 GLOBAL/platforms/{端}/（各端专业分析）
├── 自动生成 GLOBAL/INDEX.md（轻量索引）
│
├──→ split 的 Prompt 自动注入：
│    ├── 📌 必读：INDEX.md 全文（≤ 1500 字）
│    └── 📂 可选：TOC 目录（文件路径 + 描述 + ## 标题列表）
│
├──→ execute 的 Prompt 自动注入：
│    ├── 📌 必读：INDEX.md 全文
│    ├── 📂 可选：TOC 目录（综合文档 + 各端文档）
│    └── 💡 当前端标记 ⬅ 箭头，AI 自行 Read 需要的文件
│
└──→ analyze 的 Prompt 自动注入：
     ├── 📌 必读：INDEX.md 全文
     └── 📂 可选：TOC 目录
```

### AI 在 Prompt 中看到的全局知识库段

```markdown
## 🌐 全局知识库
> 必读内容已注入，其余文件请按需自行 Read。

### 📌 必读（已注入）
（INDEX.md 全文 — 工程列表、各端文档清单、跨端综合文档清单）

### 📂 可选参考（按需 Read）
> 当前任务涉及 **admin** 端，建议优先参考该端文档

**全局综合文档** (.speccore/GLOBAL/)
- `synthesis/ARCHITECTURE.md` — 全量系统架构
  章节: 系统架构概览 | 服务依赖 | 技术栈 | 部署架构 | 架构决策(ADR) | 安全架构
- `synthesis/TECH_FULL.md` — 全量技术方案
  章节: 公共模块 | API版本策略 | 数据一致性 | 性能优化

**各端分析文档** (.speccore/GLOBAL/)
📂 admin/ ⬅ 当前端
  - `platforms/admin/ANALYSIS.md` — admin 端 — ANALYSIS
    章节: 功能清单 | 接口定义 | 数据模型 | 业务规则 | 安全分析
📂 h5/
  - `platforms/h5/ANALYSIS.md` — h5 端 — ANALYSIS
    章节: 功能清单 | 接口定义 | 适配方案 | 首屏性能

### 💡 使用方式
以上文件均可通过 Read 工具直接读取（路径相对于 `.speccore/GLOBAL/`）。
建议根据当前任务需要选择性阅读，不必全部读取。
```

### 实现细节

| 函数 | 位置 | 作用 |
| :--- | :--- | :--- |
| `buildGlobalTOC()` | prompt-builder.ts | 扫描 6 个来源，提取每个文件的 ## 标题行 |
| `loadGlobalContext()` | prompt-builder.ts | 必读 INDEX.md 直接注入 + 其余只给 TOC 目录 |
| `generateGlobalIndex()` | synthesize.ts (analyze --full) | Phase 2 apply 后自动生成 INDEX.md |
| `formatGlobalContext()` | prompt-builder.ts | 格式化为分组 Markdown，formatPrompt 和 split.ts 共用 |

**关键设计决策：**
- 不预取内容，只给目录 — AI 自己决定读什么，避免关键词匹配不准
- 只读 ## 标题行 — 每个文件只读几行，TOC 生成非常快
- 过滤时间戳备份文件 — `isTimestampBackup()` 排除 `.bak` 类文件
- 当前端标记 — execute 时自动标记当前端的文档，引导 AI 优先参考
- 6 个来源全覆盖 — synthesis/platforms/PROJECTS/扁平文件/PATTERNS/RULES 全部纳入 TOC
- `formatGlobalContext()` 公共函数 — formatPrompt 和 split.ts 共用同一套分组逻辑

---

## 二、Layer 1：全局约束（程序自动解析）

### CONSTITUTION.md → spec-rule 规则注入

在 CONSTITUTION.md 中用 `<!-- spec-rule: xxx -->` 标记的规则，会在 `speccore execute` 时自动注入到生成的代码中。

**标记格式：**

```markdown
<!-- spec-rule: exception-handler -->
- 统一异常：所有 Controller 抛出 BusinessException
- 全局捕获：@ControllerAdvice 处理
<!-- speccore rule -->
```

**支持的五类规则及效果：**

| 规则名 | 作用 | 生成代码变化 |
| :--- | :--- | :--- |
| `exception-handler` | 异常处理方式 | `return ok()` → `throw new BusinessException()` |
| `response-format` | 返回格式 | `ResponseEntity<?>` → `Result<T>` |
| `orm` | ORM 框架 | JPA → MyBatis-Plus 模板 |
| `validation` | 参数校验 | 自动 import `@Valid` / `javax.validation.*` |
| `naming` | 命名约定 | Controller → XxxController 等 |

**改动后效果：改一处 CONSTITUTION，所有后续 `speccore execute` 自动生效。**

### TECH_STACK.md → 技术栈检测

用 `<!-- tech-stack: backend -->` 和 `<!-- tech-stack: frontend -->` 标记，execute 自动检测语言和框架。

```markdown
<!-- tech-stack: backend -->
- 语言: Go 1.21
- 框架: Gin
- ORM: GORM
<!-- /tech-stack -->

<!-- tech-stack: frontend -->
- 框架: React 18
- UI: Ant Design
<!-- /tech-stack -->
```

执行时显示当前技术栈：

```bash
speccore execute --task=Task-001 --force
# → Tech Stack: Gin + React
```

支持检测的语言：Java / TypeScript / Go / Python

## 三、Layer 2：期次上下文（人类文档）

这些文件不参与代码生成，但提供关键的项目信息：

| 文件 | 用途 | 谁看 |
| :--- | :--- | :--- |
| `010-requirements/REQUIREMENT.md` | 本期要做的所有需求、优先级、里程碑 | PM、开发者 |
| `020-specs/ANALYSIS.md` | 需求分析 | 开发者 |
| `020-specs/TECH.md` | 技术方案 | 开发者 |

## 四、Layer 3：Task 执行（核心输入）

每个 Task 目录是 execute 的核心输入：

```
Task-001-订单管理/
├── _shared/
│   └── API_CONTRACT.yaml     → 接口契约
├── backend/
│   ├── REQ.md                → 需求文档（接口表格解析 ✓）
│   ├── TECH.md               → 技术方案
│   └── TASK.md               → 任务分解（状态更新 ✓）
└── frontend/
    └── web/
        ├── REQ.md            → 前端需求
        └── TASK.md           → 前端任务
```

**execute 的工作流程：**

1. 加载 CONSTITUTION.md → 提取 spec-rule 规则
2. 加载 TECH_STACK.md → 检测语言/框架
3. 读取 Task/backend/REQ.md → 解析接口表格
4. 根据 REQ.md 接口 + spec-rule 规则 + 技术栈 → 生成代码

## 五、其他文件（人类文档）

这些文件不参与代码生成，但同样重要：

| 文件 | 用途 | 谁看 |
| :--- | :--- | :--- |
| `GLOBAL/OVERVIEW.md` | 项目全景描述 | 新人/管理者 |
| `GLOBAL/INDEX.md` | 需求全局索引 | 开发者查找 |
| `GLOBAL/CHANGELOG.md` | 版本变更历史 | 全员 |
| `GLOBAL/GLOSSARY.md` | 术语定义表 | 全员统一用语 |
| `GLOBAL/CODE_INDEX.md` | 代码路径映射 | 开发者查文件 |
| `RULES/CODE_REVIEW.md` | 代码审查清单 | Code Review 时对照 |
| `RULES/POST_COMPLETION.md` | Task 完成检查清单 | 开发者 |
| `PROJECT/INDEX.md` | 项目索引 | 项目管理者 |
| `PROJECT/TEAM.md` | 团队成员与分工 | 全员 |

## 六、完整开发流程

### 💬 对话式（推荐新用户）

```
1. "我的 Java 项目用 Spring Boot + JPA，异常统一用 ApiException"
   → AI 自动创建 CONSTITUTION.md spec-rule + TECH_STACK.md

2. "创建 Q3 期次"
   → AI 调用 speccore iteration create --name=Q3

3. "创建一个订单管理的 Feature 任务"
   → AI 调用 speccore task new --name="订单管理"

4. "订单管理 Task-001 需要 CRUD，加上分页和软删除"
   → AI 填充 REQ.md 接口表格

5. "开发 Task-001"
   → AI 调用 speccore execute --task=Task-001 --force

6. "检查代码和 Spec 是否一致"
   → AI 调用 speccore sync --task=Task-001 --detect
```

### ⌨️ 命令行式

```bash
# 1. 配置全局规则（一次性）
vim .speccore/CONSTITUTION.md      # 加 spec-rule 标记
vim .speccore/GLOBAL/TECH_STACK.md # 加 tech-stack 标记

# 2. 创建期次和任务
speccore iteration create --name=Q3
speccore task new --name="订单管理" --platforms=web,backend

# 3. 写需求文档
vim Iteration-Q3/Task-001-订单管理/backend/REQ.md
# | POST | /api/v1/orders | 创建订单 |
# | GET  | /api/v1/orders | 查询列表 |

# 4. 执行（全局规则 + 技术栈自动注入）
speccore execute --task=Task-001 --force
# → Tech Stack: Spring + Vue
# → 生成 Controller: Result<?> create() throw BusinessException()
# → 生成 Vue 组件
```

## 七、备份与回滚

AI 修改任何 Spec 文件前自动创建 `.bak` 备份，防止改坏：

```bash
# 对话回滚
"刚才改的 Task-001 不对，帮我回滚"  → AI 从 .bak 恢复

# CLI 回滚
speccore rollback --task=Task-001 --list       # 查看备份
speccore rollback --task=Task-001 --confirm    # 确认恢复
```

备份存在同目录下（如 `REQ.md.bak`），恢复后自动清理，24 小时后过期。
