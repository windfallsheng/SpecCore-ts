# SpecCore 架构设计

> **锁定期望效果**。本文档描述 SpecCore 的组织规范和流程设计，是代码实现的目标态。

---

## 1. 全局工程组织

### 1.1 工程级

```
workspace/
├── .speccore/GLOBAL/              ← 跨工程全局索引（唯一一份）
│   ├── INDEX.md                   ← 所有迭代的摘要索引
│   ├── REQUIREMENTS.md           ← 所有工程的需求合并视图
│   └── ARCHITECTURE.md           ← 跨工程的服务依赖关系
│
├── project-a/                     ← 独立工程 A
│   ├── .speccore/                 ← 工程自己的配置（独立）
│   │   ├── CONSTITUTION.md       ← 技术栈、工程列表、需求端映射
│   │   └── local/context.json    ← 当前活跃迭代
│   ├── src/                      ← 源码
│   └── Iteration-NNN-name/       ← 期次
│
└── project-b/                     ← 独立工程 B
    ├── .speccore/CONSTITUTION.md  ← 不同技术栈
    └── ...
```

### 1.2 分层规则

| 层级 | 职责 | 共享 |
|------|------|:--:|
| **GLOBAL** | 需求合并视图、跨工程索引、服务依赖 | 一份 |
| **工程 .speccore/** | 技术栈、规范、平台映射、活跃迭代 | 每工程独立 |
| **工程 Iteration-*/** | 需求文档、分析、任务、进度 | 每迭代独立 |

### 1.3 全局同步

```
工程 A: done/retro → GLOBAL/INDEX.md: Iteration-001: status=70%, features=[auth✓,catalog✓]
工程 B: done/retro → 同文件追加: Iteration-002: status=100%, features=[payment✓]
```

**GLOBAL 存指针，不存副本。**

---

## 2. CONSTITUTION.md 设计

### 2.1 工程-需求端映射

```markdown
| 工程 | 源码路径 | Git 仓库 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- | :--- | :--- |
| order-service | ./packages/order | git@xxx | main | app, admin |
| web-app | ./src/frontend | git@xxx | main | app, h5 |
```

"对应需求端"列决定：analyze 写哪、split 拆几个端、execute 拉什么分支。

### 2.2 技术栈

```markdown
## 技术栈
### 后端: 语言 / 框架 / 数据库 / 缓存
### 前端: 框架 / 状态管理 / UI 组件
```

### 2.3 Git 分支策略

```markdown
- 默认分支: main
- 任务分支: feature/{Task-ID}
- 发布分支: release/{version}
- 保护分支: main, master, release/*, production
```

**保护分支规则：**
- 在 CONSTITUTION.md 的「保护分支」字段配置，支持精确匹配和通配符（如 `release/*`）
- 保护分支上禁止直接 commit 和 push，只能通过 PR 合并
- 通过 pre-commit 和 pre-push git hook 自动拦截
- 允许从保护分支创建任务分支，但不允许直接在其上工作

**分支创建策略（懒创建 + 依赖合并）：**
- 每个任务的分支在执行前才创建，确保依赖任务的代码已存在
- 有依赖的任务会 merge 依赖分支，拿到前序任务的代码
- 多依赖时可合并多个分支

```
Task-001 执行前:
  checkout main → 创建 feature/Task-001 → 执行

Task-002 执行前（依赖 Task-001）:
  checkout main → 创建 feature/Task-002 → merge feature/Task-001 → 执行
```

**计划自动生成策略：**
- 用户执行 `speccore plan` 时始终生成 `PLAN.md` + `speccore-plan.html`
- 用户执行 `speccore execute` 多任务时（>1 个任务），自动生成计划文件到 `000-overview/plans/`
- 计划包含：依赖拓扑图（Mermaid）、甘特图（实际日期）、执行概览表、任务详情、风险评估、里程碑、回滚方案
- `generatePlan()` 按依赖感知分阶段：每阶段放入当前可并行的任务（依赖已完成的优先）

---

## 3. 迭代目录结构

```
Iteration-NNN-name/
├── 000-overview/                  ← 进度总览
├── 010-requirements/              ← 按功能组织（非按端）
│   ├── sources/                  ← 原始 PRD
│   ├── assets/{prd,prototypes,designs}/
│   └── {feature}/README.md       ← 每个需求一份，描述所有端
├── 020-specs/                     ← 迭代级 analyze 输出（全局基线）
│   ├── ANALYSIS.md               ← 需求分析
│   ├── TECH.md                   ← 技术方案
│   ├── TEST.md                   ← 测试计划
│   ├── REVIEW.md                 ← 评审清单
│   ├── RISK.md                   ← 风险评估
│   ├── DEPS.md                   ← 依赖清单
│   ├── MONITOR.md                ← 监控方案
│   └── REQUIREMENT.md            ← 需求规格汇总
├── 030-tasks/                     ← 所有开发任务
│   └── Task-NNN-name/
│       ├── .meta/                 ← 任务元信息（type/status/owner）
│       ├── _shared/               ← 跨平台共享契约
│       │   └── API_CONTRACT.yaml
│       ├── 00-specs/              ← 任务级核心规格（执行前必读）
│       │   ├── REQ.md             ← 需求切片 + 验收标准
│       │   ├── TECH.md            ← 技术方案
│       │   ├── TASK.md            ← 任务履历 + 产出物清单
│       │   ├── SCHEMA.md          ← 数据库 Schema（可选）
│       │   └── CHANGELOG.md       ← 需求变更记录
│       ├── 10-backend/            ← 后端实现（execute 生成）
│       ├── 20-frontend/           ← 前端实现（execute 生成）
│       ├── 99-artifacts/          ← 执行产出（TEST/REVIEW/RISK/DEPS/...）
│       └── .issues.md             ← 问题追踪
└── STAFFING.md
```

### 目录编号

| 编号 | 含义 |
|:--:|------|
| 000 | 总览信息 |
| 010 | 输入层（需求） |
| 020 | 分析层（规约） |
| 030 | 任务层（开发） |
| 050 | 导出层（dashboard/spec2doc/retro 产出）预留 |
| 060 | 日志层（plan/schedule/execute 记录）预留 |

### 核心原则

**需求按功能组织，分析按端拆分，任务按端+功能创建。**

```
文档:  010-requirements/user-auth/README.md
分析:  020-specs/ANALYSIS.md + TECH.md + TEST.md + ...
任务:  030-tasks/Task-001-app-auth/  +  Task-002-admin-auth/
```

### 双层规格解耦

`020-specs/` 是**迭代级全局基线**，`Task/00-specs/` 是**任务级切片**。

```
020-specs/（全局视角）
    │
    │  split 读取 REQUIREMENT.md 按章节拆分
    │  每个 Task 拿到属于自己那块需求的子集
    ▼
030-tasks/Task-001/00-specs/（切片视角）
├── REQ.md    ← 从需求文档切出的片段 + 自动生成的验收标准
├── TECH.md   ← 骨架（AI-FILL 占位），split 注入相关接口信息
└── ...
```

**解耦规则：**

| 操作 | 写入位置 | 说明 |
|:---|:---|:---|
| 迭代级 `analyze`（无 `--task`） | `020-specs/` | 迭代全量分析，建立基线 |
| 任务级 `analyze --task Task-001` | `Task-001/00-specs/` | 任务独立分析，**不覆盖迭代基线** |
| `split` | `Task-NNN/00-specs/` | 从迭代需求切片，创建任务骨架 |

- 两层完全独立，互不覆盖
- 任务重新分析时，从原始需求（`010-requirements/`）重新读取，不回读 `020-specs/` 已有内容
- 任务级原型/图片/设计稿统一放在迭代级 `010-requirements/assets/`，任务通过相对路径引用

---

## 4. 核心命令流水线

```
init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc
```

### 各阶段职责

| 阶段 | 输入 | 输出 |
|------|------|------|
| init | - | `.speccore/` + `Iteration-sample/` + AGENTS.md |
| doc2spec | Word/MD PRD | `010-requirements/{feature}/README.md` |
| analyze | 010-requirements/ 所有 .md → CONSTITUTION 映射 | `020-specs/{platform}/{feature}.md` |
| split | 020-specs/{platform}/ → 扫描子目录 | `030-tasks/Task-NNN/` |
| plan | 任务列表 + STAFFING | `PLAN.md` + `speccore-plan.html` + `plan.json` |
| execute | REQ.md + TECH.md → AI 生成代码 | 源码 + .issues.md + 多任务时自动生成 `PLAN.md` |
| pr | git branch | Git PR |
| done | Task 完成归档 | GLOBAL/INDEX 更新 |
| spec2doc | 020-specs/ | Word/PDF/HTML |

### 错误处理

```
execute --all → 部分失败 → .issues.md + .needs-retry → --resume 续跑
```

### 回顾复盘 🔒 AI 命令

```bash
# 🔒 AI 命令（在 AI IDE 中使用 @spec-ask）
speccore retro --task Task-001        ← 单个
speccore retro --all                  ← 全部
speccore retro --all --owner 张三     ← 按人
speccore retro --all --type bugfix    ← 按类型
```

---

## 5. Skill + CLI 架构

### 5.1 核心理念

**CLI 输出标签 → AI 执行命令 → CLI 输出下一标签。标签驱动的闭环，AI 和 CLI 交替协作，不输出命令文本给用户复制。**

```
用户自然语言
  → AI 执行 speccore ask
    → CLI 输出 [SPECCORE_EXEC: analyze --prompt]
      → AI 执行 analyze
        → CLI 输出 [SPECCORE_PROMPT]... → AI 生成内容
        → CLI 输出 [SPECCORE_EXEC: plan --prompt]
          → AI 执行 plan...
```

### 5.2 命令分类与执行原则

| 类型 | 示例 | 执行方式 |
|:---|:---|:---|
| **🔒 需 AI 参与** | `analyze --prompt`、`plan --prompt`、`execute --prompt` | 必须走 `[SPECCORE_EXEC]` 标签，AI 用 `execute_command` 执行 |
| **✅ 纯 CLI** | `schedule`、`daemon`、`context`、`dashboard` | AI 执行或终端跑都行 |
| **✅ 查看/展示** | `about`、`welcome`、`ask` | AI 执行，用 `file://` 或 `present_files` 展示结果 |

**🚫 绝不输出命令文本让用户复制**——那等于把 AI 踢出循环。

### 5.2 路由器 Skill

统一入口 `.agents/skills/speccore-router/SKILL.md`，20+ 意图映射：

| 用户说 | 输出 | 类型 |
|------|------|:---:|
| "开发 Task-001" | `speccore execute -t Task-001 --force` | 🔒 AI |
| "分析 Q1" | `speccore analyze -I Q1` | 🔒 AI |
| "拆分任务" | `speccore iteration split -I Q1` | 🔒 AI |
| "查看进度" | `speccore dashboard` | ✅ CLI |
| 复杂意图 | `speccore ask "用户原话"` ← fallback | 🔒 AI |

### 5.3 ask 引擎四大模式

| 模式 | 场景 | 识别方式 |
|------|------|------|
| **explain** | 解释命令 | 知识库匹配 |
| **guide** | 流程指引 | 工作流生成 |
| **match** | 意图匹配 | 直接映射命令 |
| **pipeline** | 复杂编排 | plan + schedule + execute |

### 5.4 意图合成（synthesizeIntent）

三层分析链路：
```
输入 → ① 参数提取(时间/类型/优先级/名称) 
     → ② 上下文补全(迭代/批次从context.json)
     → ③ 命令自检(遗漏检查+置信度评分)
     → ④ 仅歧义时确认
```

### 5.5 双模式确认

| 用户表述 | 模式 | 行为 |
|:---|:---|:---|
| 未说自主/一键 | **交互模式** | 展示理解 → 等用户确认 → 执行 |
| 说了"自主/一键" | **自主模式** | 展示理解 → 确认一次 → 全自动执行 |
| 纯单命令 | **跳过确认** | 简单无歧义直接执行 |

### 5.6 HTML 页面输出规范

所有 HTML 页面（引导页、about 等）同时输出两种格式：
- `file://` 链接：用户可直接点击打开
- `[SPECCORE_xxx: path]` 标签：WorkBuddy 走 `present_files` 展示

### 5.7 Ask 引擎 v2.0 — 三段式动态路由

> 设计原则：**本地优先、AI 补位、缓存固化、渐进智能**

#### 5.7.1 四层路由架构

```
用户输入
  │
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第零层: 确定性   │────→│ 切上下文/直接路由 │ ← 零成本，最高优先级
└─────────────────┘     └─────────────────┘
  │ 不匹配
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第一层: 意图缓存 │────→│ 精确/模糊命中即返 │ ← 零成本，越用越快
└─────────────────┘     └─────────────────┘
  │ 未命中
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第二层: 本地引擎 │────→│ 关键词+正则+上下文 │ ← 零成本，毫秒响应
└─────────────────┘     └─────────────────┘
  │
  ▼ 三段式动态路由
  ├─ 高分区 ≥70 ──→ 本地直接执行（不打扰 AI）
  ├─ 中分区 45~69 ─→ 双路并行，取更优结果
  └─ 低分区 <45 ──→ 直接交给 AI，本地只提取参数
  │
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第三层: 宿主AI   │────→│ 语义理解+RichContext│ ← IDE 自带，免费
└─────────────────┘     └─────────────────┘
  │ 不可用
  ▼
┌─────────────────┐     ┌─────────────────┐
│ 第四层: 自有LLM  │────→│ 多Provider冗余路由 │ ← 用户自配，默认禁用
└─────────────────┘     └─────────────────┘
  │ 全失败
  ▼
┌─────────────────┐
│ 兜底: 本地结果   │
└─────────────────┘
```

#### 5.7.2 三段式动态路由策略

| 置信度区间 | 行为 | 成本 |
|:---|:---|:---|
| **≥ highThreshold (70)** | 本地引擎直接执行，不打扰 AI | 零 |
| **lowThreshold ~ high (45~69)** | 本地已就绪，同时触发宿主AI；AI 返回有效结果则优先AI，否则回退本地 | 视AI可用性 |
| **< lowThreshold (45)** | 直接交给 AI，本地引擎仅负责提取参数（通过 `candidates` 传入 Rich Context） | 零或低 |

**`--rules` 强制开关**：命令行传入 `--rules` 或配置 `forceHostAi: true` 时，无论置信度多少，强制走 AI 路径。

#### 5.7.3 意图缓存与自学习

```
精确匹配 ──→ 相同输入直接命中返回
    │
模糊匹配 ──→ 编辑距离 ≤2 也命中（容错拼写错误）
    │
命中统计 ──→ 记录命中次数、最后使用时间
    │
缓存固化 ──→ 命中次数 ≥ cacheMinHits (默认3) 视为高频意图，持久化到磁盘
```

缓存文件：`.speccore/local/intent-cache.json`

#### 5.7.4 Rich Context 构建器

为宿主AI / LLM 提供决策所需的完整上下文，而非让AI"盲猜"：

| 上下文维度 | 内容 | 用途 |
|:---|:---|:---|
| **候选意图** | 本地引擎 Top-3 意图 + 置信度 | 让AI做"选择题"而非"填空题" |
| **项目阶段** | 当前生命周期（init/plan/execute/done） | AI 知道该推荐什么命令 |
| **活跃迭代** | 当前上下文中的 iteration + task | 精准定位操作目标 |
| **历史命令** | 最近 10 条命令的时间序列 | 行为模式推断 |

输出标记：`[SPECCORE_AI_CONTEXT]...[/SPECCORE_AI_CONTEXT]`

#### 5.7.5 多 LLM 冗余路由（默认禁用）

用户可在 `.speccore/config/ask.json` 中配置自有 LLM Provider：

```json
{
  "llmProviders": [
    { "name": "ollama-local", "enabled": false, "type": "ollama", "priority": 1 },
    { "name": "openai-compatible", "enabled": false, "type": "openai", "priority": 2 }
  ]
}
```

- 按 `priority` 排序，依次尝试
- 全部失败时回退宿主AI → 本地兜底
- 默认全部 `enabled: false`，零成本

#### 5.7.6 配置体系

配置优先级：**环境变量 > `.speccore/config/ask.json` > 内置默认值**

```json
{
  "routing": {
    "mode": "hybrid",
    "highThreshold": 70,
    "lowThreshold": 45,
    "autoHostAi": true,
    "cacheEnabled": true,
    "cacheMinHits": 3
  },
  "rules": {
    "forceHostAi": false
  }
}
```

| 配置项 | 说明 |
|:---|:---|
| `mode` | `hybrid`(混合) / `local-only`(纯本地) / `ai-first`(AI优先) |
| `highThreshold` | 本地直接执行阈值 |
| `lowThreshold` | AI 接管阈值 |
| `autoHostAi` | 中低分区是否自动调用宿主AI |
| `cacheEnabled` | 是否启用意图缓存 |
| `cacheMinHits` | 缓存固化阈值 |
| `forceHostAi` | 等价于命令行 `--rules` |

---

## 6. 全平台 AI 适配矩阵

### 6.1 生成的文件

`speccore init` 自动生成：

```
项目根目录/
├── AGENTS.md              ← 通用标准（Cursor/Copilot/Windsurf/Codex）
├── CLAUDE.md              ← Claude Code 引用 @AGENTS.md
├── .qoder/rules/          ← Qoder 规则
│   └── speccore.md
├── .qoder/commands/       ← Qoder 斜杠命令（spec:X.md 格式）
├── .agents/skills/        ← TRAE 技能
│   ├── speccore-router/SKILL.md
│   ├── spec-ask/SKILL.md
│   ├── spec-execute/SKILL.md
│   └── ...
└── .trae/commands/        ← TRAE 斜杠命令
```

### 6.2 覆盖矩阵

| 工具 | 机制 | 自动 |
|------|------|:--:|
| WorkBuddy | `.speccore/` + CONSTITUTION.md | ✅ |
| Cursor/Copilot/Windsurf | `AGENTS.md` | ✅ |
| Codex | `AGENTS.md` | ✅ |
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | ✅ |
| Qoder | `.qoder/rules/` + `.qoder/commands/spec:X.md` | ✅ |
| TRAE | `.agents/skills/` + `.trae/commands/` | ✅ |

### 6.3 HTML 页面视觉规范

所有 HTML 展示页面（about / dev / welcome / ask / help / retro 等 20 页）统一遵循以下规范。

#### 光晕效果

单卡页面头部叠加 `card-bg` 光晕层：
```css
.card-bg {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background: radial-gradient(ellipse at 50% 10%, rgba(14,165,233,.25) 0%, transparent 70%);
  animation: cardGlow 3s ease-in-out infinite;
  transform-origin: top center;
}
@keyframes cardGlow {
  0%, 100% { opacity: .5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.6); }
}
```
光晕圆心位于卡片顶部 10%（标题文字下方），水平居中，呼吸扩张方向锚定顶部。

#### 标题发光

所有 `<h1>`/`<h2>` 统一呼吸发光：
```css
h1, h2 {
  text-shadow: 0 0 20px rgba(14,165,233,.4), 0 0 60px rgba(14,165,233,.15);
  animation: titleGlow 3s ease-in-out infinite;
}
@keyframes titleGlow {
  0%, 100% { text-shadow: 0 0 20px rgba(14,165,233,.4), 0 0 60px rgba(14,165,233,.15); }
  50% { text-shadow: 0 0 30px rgba(14,165,233,.7), 0 0 80px rgba(14,165,233,.3); }
}
```

#### 四边扫描线

每张卡片叠加横向脉冲（`card::before`/`card::after`）+ 纵向脉冲（`vline.l`/`vline.r`）。

#### ask 页面特殊规则

- 标题用 HTML `<h1>` + `<div class="sub">`，自动继承发光；SVG 仅承载下方流程图
- SVG viewBox 裁掉顶部空白：`0 80 680 420`
- 底部 badge-line + footer 在卡片内部
- 所有 `speccore ask` 文字统一为 `/spec-ask`

#### HTML 文件与功能对应

| 文件路径 | 功能 | CLI 命令 |
|:---|:---|:---|
| `speccore-about.html` | 关于页面：版本、GitHub、维护状态 | `speccore about` |
| `speccore-ask-onboarding.html` | Ask 首次引导页：4 模式流程图 | `speccore ask "…"` (无高速?缓存时) |
| `speccore-ask-result.html` | Ask 结果展示 | `speccore ask` |
| `speccore-dev.html` | 开发者工作台 | `speccore dev` |
| `deploy/welcome.html` | 项目名片/欢迎页 | `speccore welcome` |
| `deploy/index.html` | 全局看板（所有项目聚合） | `speccore dashboard --scope global` |
| `deploy/status.html` | 迭代数据看板（当前迭代） | `speccore dashboard` / `speccore status-panel` |
| `templates/html/speccore-*.html` | Ask 模式子页 + help/retro/demo 模板 | `speccore ask` 内部路由 / `speccore help` / `speccore retro` |


#### 版本号同步

| 页面类型 | 版本来源 |
|:---|:---|
| 静态 HTML | `npm run build` → `sync-version.js` 从 package.json 自动同步 |
| 动态渲染（plan/dashboard） | 运行时从 package.json 读取 |


---

## 7. 调度与守护进程

调度和守护是 SpecCore CLI 自身的 TypeScript 功能，与宿主 AI 无关。

### 7.1 调度生命周期

```
speccore schedule create --at "20:00" --all
  → 写入 .speccore/local/schedule.json
  → 自动安装系统守护 + 启动 daemon（懒启动）

speccore schedule daemon start
  → 启动 Node.js 守护进程（幂等，已运行则跳过）

speccore schedule retry --id <id> [--at "新时间"]
  → 重新调度失败/未触发的任务

speccore schedule cancel --id <id>
  → 取消调度；pending=0 → 自动停 daemon（懒停止）

到点: daemon → speccore execute → CLI 执行（🔒 AI 命令，通过 Prompt/Apply 循环触发）
```

### 7.2 跨平台守护

| 平台 | 机制 | 触发 |
|:---|:---|:---|
| macOS | LaunchAgent (`~/Library/LaunchAgents/`) | RunAtLoad + KeepAlive |
| Linux | crontab | 每 5 分钟 |
| Windows | Task Scheduler (`schtasks`) | 每 5 分钟 |

- `init` / `init --update` 自动安装
- `schedule create` 自动重装到当前项目目录
- daemon 用 `daemonPid` 记录防多开

### 7.3 懒启动/懒停止

- 创建调度 → 自动启动 daemon
- daemon 每 30s 轮询 → 无 pending 任务 → 自动 exit(0)
- 零空闲资源消耗

---

## 8. 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 迭代 | `Iteration-{ID}-{slug}` | `Iteration-001-ecommerce` |
| 任务 | `Task-{ID}` | `Task-001` |
| 目录 | 3位数字步长10英文 | `000-overview` `010-requirements` |
| 需求端 | 小写英文 | `app` `h5` `miniapp` `admin` |
| 分支 | `feature/Task-{ID}` | CONSTITUTION 定义 |

---

## 9. 版本记录

| 版本 | 日期 | 关键变更 |
|------|------|------|
| v5.27.25 | 08-06 | 强化 TRAE skill 反绕过、pandoc 多路径检测 |
| v5.27.26 | 08-07 | 需求按功能组织、analyze 按需求×端、split 扫描 020-specs |
| v5.27.27 | 08-07 | Skill+CLI 输出模式、统一路由器 Skill |
| v5.27.28 | 08-07 | AGENTS.md + CLAUDE.md 全平台适配 |
| v5.27.29 | 08-07 | Qoder .qoder/rules/ 自动生成 |
| v5.27.34 | 08-07 | Prompt 架构落地: Skill→CLI→AI→CLI 协作循环 |
| v5.27.35 | 08-07 | CONSTITUTION 增加"项目名称"列、init 残留清理、意图识别平台参数 |
| v5.30.0 | 08-07 | 可执行编排引擎 v4 + 升级提示 + 数据保护 + 管道传递 |
| v5.32.0 | 08-07 | 强制分析保护：任务无 ANALYSIS.md 禁止 execute |
| v5.56.0 | 08-08 | Daemon 懒启动/懒停止、跨平台守护安装(LaunchAgent/cron/schtasks) |
| v5.58.0 | 08-08 | Ask 双模式(自主/交互)、plan --select 多选 |
| v5.59.0 | 08-08 | 意图加权得分系统(替代关键词硬匹配) |
| v5.60.0 | 08-08 | 意图确认步骤(SPECCORE_INTENT + SPECCORE_CONFIRM_NEEDED) |
| v5.63.0 | 08-08 | synthesizeIntent 智能意图合成(参数提取+补全+自检) |
| v5.64.0 | 08-08 | speccore about 版本信息页、引导页 file:// 链接 |
| v5.65.0 | 08-08 | schedule retry/多调度管理、引导页优先输出 |
| v5.69.0 | 08-10 | HTML 视觉规范统一：全页面光晕+标题呼吸发光+四边扫描线；ask onboarding SVG→HTML标题重构；/spec-ask 文案统一；Qoder 命令 spec:X.md 格式；sync-version.js 版本自动同步 |

> **最后更新**: 2026-08-10 (v5.69.0) — HTML 视觉规范统一 + 版本号自动同步

---

## 13. 可执行编排引擎（spec-ask v4）

### 13.1 五分支决策树

```
用户输入 → 步骤0 判断类型 → 步骤1 意图识别 [SPECCORE_MODE] → 分支选择

分支 A: match    → 补参 → 确认 → --prompt → 自己生成 → 校验 → --response
分支 B: ambiguous → 展示候选人 → 用户选 → 分支A
分支 C: explain  → 直接回答，不调CLI
分支 D: pipeline  → 展示≤5步 → 逐步确认 → 产物传递
分支 E: guide    → 展示流程 → 进D或结束
```

### 13.2 协作协议

| exitCode | 含义 | 标准行为 |
| :--- | :--- | :--- |
| 0 | 确定性操作完成 | 展示结果 → 推荐下一步 |
| 10 | 需要 AI | 提取 [SPECCORE_PROMPT] → 自己生成 → --apply |
| 11 | 缺参数 | 展示 [SPECCORE_NEEDS_INFO] 参数表 → 用户补 |

### 13.3 管道传递

```
Write /tmp/speccore-resp.json
cat /tmp/speccore-resp.json | speccore execute --response - -t Task-001
```

---

## 14. 升级与数据保护

### 14.1 文件保护策略

| 文件 | 策略 |
| :--- | :--- |
| CONSTITUTION.md | 永远不覆盖 → 生成 UPGRADE.md 对比文件 |
| context.json | 永远不覆盖 |
| Iteration-*/ | 永远不覆盖 |
| AI-RULES/AGENTS/Skills/模板 | 自动更新 + 输出清单 |

### 14.2 升级提示机制

每次 init 对比 `last-init-version.txt`，检测模板变化：
1. CONSTITUTION 缺新字段 → 生成 `.speccore/local/UPGRADE.md`
2. 输出自动更新文件清单
3. AI 模式：用户说"升级" → AI 智能合并
4. 手动模式：对照 UPGRADE.md 自行修改

### 14.3 低置信拒绝与歧义检测

- confidence < 45% → 拒绝匹配
- best.confidence - second.confidence < 15% → ambiguous 模式

---

## 10. Skill + CLI + AI 协作架构（Prompt/Apply 模式）

### 10.1 核心原则

```
CLI 只做确定性操作，不做内容生成。
代码/分析/拆分等创造性工作完全由宿主 AI 完成。
```

**角色分工**：
| 角色 | 职责 | 示例 |
| :--- | :--- | :--- |
| Skill（.agents/skills/） | 编排流程、调用 CLI、触发 AI | `spec-execute` Skill |
| CLI（speccore） | 读写文件、构建 Prompt、写入结果 | `speccore execute --prompt` 🔒 |
| 宿主 AI（Qoder/Trae/Claude） | 语义理解、内容生成、代码编写 | 根据 Spec 生成 Java 代码 |

### 10.2 Prompt/Apply 协作循环

```
┌──────────────────────────────────────────────────────────────┐
│  SpecCore Prompt/Apply 协作循环                               │
│                                                               │
│  Skill                    CLI                   宿主 AI       │
│    │                       │                       │          │
│    │ ① execute_command ──▶│                       │          │
│    │    --prompt           │ ② 读 Spec             │          │
│    │                       │ ③ 输出 Prompt ──────▶│          │
│    │    ◀── capture stdout │                       │          │
│    │                       │                       │ ④ 生成   │
│    │  ⑤ extract prompt ──────────────────────────▶│          │
│    │                       │      ◀── ⑥ 返回代码 ─│          │
│    │                       │                       │          │
│    │  ⑦ execute_command ──▶│                       │          │
│    │    --response         │ ⑧ 解析 JSON           │          │
│    │                       │ ⑨ 写入文件            │          │
│    │                       │ ⑩ 更新状态            │          │
│    │    ◀── ✅ done        │                       │          │
└──────────────────────────────────────────────────────────────┘
```

**步骤说明**（🔒 AI 命令，通过 Skill → CLI → AI 协作执行）：
1. Skill 调用 `speccore execute --prompt -t Task-001`
2. CLI 读取 Task 的 REQ.md、TECH.md、CONSTITUTION.md
3. CLI 构建结构化 Prompt，输出到 stdout（`[SPECCORE_PROMPT]...[/SPECCORE_PROMPT]`）
4. Skill 通过 `execute_command` 工具返回值捕获 stdout
5. Skill 提取 Prompt 内容，作为上下文传给宿主 AI
6. 宿主 AI 返回 JSON：`{"files": [{"path": "...", "content": "..."}]}`
7. Skill 调用 `speccore execute --response '{json}' -t Task-001`
8. CLI 解析 JSON，写入文件，更新 PROJECT_GRAPH 状态

### 10.3 Prompt 结构化格式

```
[SPECCORE_PROMPT]
# 任务: execute — Task-001

## 技术栈
- 语言: Java
- 框架: Spring Boot 3.x
- 数据库: MySQL 8.0

## API 接口定义
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/auth/login | 登录 |

## 数据模型
### User (users)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 主键 |

## 业务规则和约束
- 接口: /api/v1/{模块}/{操作}
- 错误码: 4 位数字，按模块划分

## 输出格式要求
请返回格式: {"files": [{"path": "相对路径", "content": "代码内容"}]}

## 执行指令
请根据以上 Spec 生成代码。要求: ...
[/SPECCORE_PROMPT]
```

### 10.4 适用的命令列表

| 命令 🔒 | --prompt 做什么 | --response/--apply 做什么 |
| :--- | :--- | :--- |
| `execute` | 读 Spec → 输出代码生成 Prompt | 接收 AI 代码 → 写入文件 |
| `analyze` | 读需求 → 输出分析 Prompt | 接收 AI 分析 → 写入 ANALYSIS.md |
| `split` | 读分析结果 → 输出拆分 Prompt | 接收 AI 拆分 → 创建 Task 目录 |
| `plan` | 读 Task 列表 → 输出排程 Prompt | 接收 AI 计划 → 写入 plan.json |
| `doc2spec` | 读原始文档 → 输出验证 Prompt | 接收 AI 修正 → 更新 MD |

---

## 11. 定时调度机制

### 11.1 两层调度架构

```
┌──────────────────────────────────────────┐
│  Layer 1: WorkBuddy Automation (宿主)    │
│  cron-like 规则 → 定时触发 Skill          │
│  例: 每天 20:00 触发 spec-dev Skill       │
└──────────────┬───────────────────────────┘
               │ 触发
               ▼
┌──────────────────────────────────────────┐
│  Layer 2: SpecCore schedule CLI (项目)   │
│  speccore schedule create/list/daemon     │
│  例: 创建"夜间批量执行"计划               │
└──────────────┬───────────────────────────┘
               │ 调度
               ▼
┌──────────────────────────────────────────┐
│  Layer 3: spec-dev Skill                 │
│  检测当前阶段 → 拼命令 → 执行              │
└──────────────────────────────────────────┘
```

### 11.2 定时场景示例

```
场景: 每晚 8 点自动检查迭代进度并执行待办任务

1. 用户在 WorkBuddy 中创建自动化:
   - 名称: "夜间进度检查"
   - 时间: RRULE FREQ=DAILY BYHOUR=20
   - 提示词: "检查所有迭代进度，执行待办的开发任务"

2. WorkBuddy 到时间后触发 spec-dev Skill
3. spec-dev 读取 context.json → 发现阶段: execute
4. Skill 拼命令: speccore execute --all --force  🔒 AI 命令
5. CLI 走 Prompt/Apply 协作循环完成开发
```

### 11.3 CLI schedule 命令

```
speccore schedule create --name "夜间批量" --at "20:00" --batch-size 3
speccore schedule list
speccore schedule daemon  # 持续运行，等待时间触发
```

---

## 12. 与 OpenSpec 等行业工具的对比

### 12.1 相同的核心机制

SpecCore 的 Prompt/Apply 模式与以下工具的原理完全一致：

| 工具 | 确定性操作 | AI 生成 | 协作方式 |
| :--- | :--- | :--- | :--- |
| **OpenSpec** | CLI 读写文件、解析 Spec | AI 读 Spec 生成代码 | Tool Call → stdout → AI |
| **Claude Code** | 内置工具(Bash/Read/Write) | Claude 生成内容 | MCP/工具调用 |
| **Cursor Agent** | Terminal/File 操作 | GPT-4 生成代码 | agentic loop |
| **GitHub Copilot** | 文件读写、Git 操作 | 代码补全/生成 | inline suggestion |
| **SpecCore** | speccore CLI 确定性操作 | 宿主 AI(Qoder/Trae) | execute_command → stdout → AI |

### 12.2 关键差异 — SpecCore 的优势

| 维度 | OpenSpec/Claude Code | SpecCore |
| :--- | :--- | :--- |
| Prompt 构建 | AI 自己推断上下文 | CLI 程序化构建，100% 确定性 |
| Spec 规范 | 无强制格式 | CONSTITUTION.md 强制约束 |
| 跨迭代追踪 | 无 | GLOBAL 层 + PROJECT_GRAPH |
| 版本管理 | 无 | 基线 + 变更历史 |
| 质量验证 | 依赖 AI | 内置 doc-validator 6 维检测 |
| 多平台适配 | 单一工具 | Claude/Cursor/Trae/Windsurf/Qoder |
| 命令防绕过 | LLM 可能忽略 | Skill 拼命令 + CLI 执行 = 100% 可靠 |

### 12.3 技术可行性

Prompt/Apply 模式依赖的唯一前提是：**宿主 AI 环境提供 `execute_command` 工具调用能力**。

Qoder、Trae、Claude Code、Cursor 均支持此能力。因此：
- ✅ 技术上无风险
- ✅ 不需要 CLI 内置 LLM/API Key
- ✅ 不依赖特定 IDE 的通信协议
- ✅ 标准化的 `stdout` 传递，跨所有工具通用

---



## 15. 强制分析保护

### 15.1 核心规则

任务必须先分析才能执行，且分析文件必须有实质内容。空文件/TODO 占位符视为无效。

**有效性校验**:
- ANALYSIS.md > 200 字符
- 包含 API 定义、数据模型、业务规则、风险/架构等实质内容
- 不是纯 TODO/TBD 占位符

```
if ANALYSIS.md 不存在 → exitCode 11 → 必须 analyze
if ANALYSIS.md 无效(<200字/仅TODO) → exitCode 11 → 必须重新 analyze
if ANALYSIS.md 有效 → 正常执行
```

依据: 没有有效 Spec，AI 就没有生成代码的依据。Code by Spec, Not by Vibe。

```
创建任务 → 分析 (analyze --prompt) → 计划 (plan --prompt) → 执行 (execute --prompt)
     ↓
  只建不推 → 推荐后续步骤
```
> 🔒 以上均为 AI 命令，通过 Prompt/Apply 模式由 AI IDE 执行

### 15.2 execute 前置检查 🔒 AI 命令

```
execute --prompt 执行前:
  → 检查 ANALYSIS.md 或 REQUIREMENT.md 是否存在
  → 不存在 → exitCode 11 + 提示 "请先执行: speccore analyze --prompt"（🔒 AI 命令）
  → 存在 → 正常生成 Prompt
```

### 15.3 Pipeline 展示规则

- `task new` 开头的工作流 → 只展示第 1 步为"立即执行"，其余为"建议后续"
- 其他工作流 → 完整展示所有步骤

---

### 2026-08-09 设计决策汇总

#### 1. AI命令 vs CLI命令的严格分离
- CLI 命令（用户终端直接输入）: init, iteration create/list, task new/list, context, dashboard, welcome, validate, archive, config
- AI 命令（需通过 @spec-ask 路由，不能直接CLI输入）: analyze, plan, execute, split, doc2spec, spec2doc, retro, change, pr, done, dev
- 所有用户文档中 AI 命令统一用 `@spec-ask "..."` 格式，CLI 命令用 `speccore xxx`
- 各级 AGENTS.md 和 SKILL.md 中的命令表必须标注类型列（CLI/🔒 AI）

#### 2. 多文档协议（7 种 Spec 文档 × 10 种任务类型）
- iteration 范围: feature 类型 → 7 个全量文档（ANALYSIS/TECH/TEST/REVIEW/RISK/DEPS/MONITOR）
- task 范围: 按任务类型矩阵动态生成
  - feature: 7 篇
  - refactor: 5 篇 (ANALYSIS+TECH+TEST+REVIEW+RISK)
  - bugfix: 3 篇 (ANALYSIS+TECH+TEST)
  - research/review/test/docs/deploy/security/performance 各有不同组合
- --prompt 输出多文档模板，--apply 接受 JSON `{"FILENAME.md":"content"}` 一次性写入
- 实现位置: analyze.ts → buildMultiDocPrompt + DOC_MATRIX

#### 3. 自动模式分级
- 手动模式（默认）: 每步确认
- 部分自动: 用户指定"analyze+plan 自动，execute 前确认" → 前N步连续跑
- 全自动: "全自动执行" → 全部不等确认
- 触发词: "手动/默认" | "auto:step1-2" | "全自动/一键完成"

#### 4. 命名规则（--topic 强制）
- 迭代创建: `speccore iteration create -n Q1 --topic meeting-system`
- 任务创建: `speccore task new -n "用户登录" --topic user-login -i meeting-system`
- 计划文件: `PLAN-{timestamp}-{topic}.md`
- getIterationDir 同时接受短名（meeting-system）和完整名（Iteration-001-meeting-system）

#### 5. 升级检测修复
- init --update 写入 version.json 和 last-init-version.txt 两个文件
- checkUpgradeHints 读取 last-init-version.txt 判断是否需要升级提示
- 修复两个文件不同步导致的误报

#### 6. 文档双语结构
- docs/ 目录同时维护 .md（中文）和 .en.md（英文）文件
- README.md 文档表三栏: 中文 | English | 说明
- 所有文档内部链接使用实际文件名（英文），不出现中文文件名 404

