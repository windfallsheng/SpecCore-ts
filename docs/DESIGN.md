# SpecCore 架构设计

> **锁定期望效果**。本文档描述 SpecCore 的组织规范和流程设计，是代码实现的目标态。

---

## 1. 全局工程组织

### 1.1 工程级

```
workspace/
├── .speccore/GLOBAL/              ← 跨工程全局索引（唯一一份）
│   ├── INDEX.md                   ← 所有迭代的摘要索引
│   ├── REQUIREMENTS.md           ← 所有工程的需求合并视图（按需求→工程→迭代映射）
│   └── ARCHITECTURE.md           ← 跨工程的服务依赖关系
│
├── project-a/                     ← 独立工程 A
│   ├── .speccore/                 ← 工程自己的配置（独立）
│   │   ├── CONSTITUTION.md       ← 技术栈、命名规范、工程列表、对应需求端映射
│   │   └── local/context.json    ← 当前活跃迭代
│   ├── src/                      ← 源码
│   └── Iteration-NNN-name/       ← 期次（属于该工程）
│
└── project-b/                     ← 独立工程 B
    ├── .speccore/CONSTITUTION.md  ← 不同技术栈（如 Go vs Java）
    └── ...
```

### 1.2 分层规则

| 层级 | 职责 | 共享 |
|------|------|:--:|
| **GLOBAL** | 需求合并视图、跨工程索引、服务依赖 | 一份 |
| **工程 .speccore/** | 技术栈、规范、平台映射、活跃迭代 | 每工程独立 |
| **工程 Iteration-*/** | 需求文档、分析、任务、进度 | 每迭代独立 |

### 1.3 全局同步流程

```
工程 A: done/retro 时 → 写 GLOBAL/INDEX.md 一行:
  Iteration-001-ecommerce | status: 70% | features: [auth✓, catalog✓]

工程 B: done/retro 时 → 更新同一 INDEX.md:
  Iteration-002-payment | status: 100% | features: [payment✓]
```

**GLOBAL 存指针，不存副本**。详细数据始终在各自工程的 Iteration 目录下。

---

## 2. CONSTITUTION.md 设计

CONSTITUTION 是 SpecCore 与 AI 的最高优先级契约。

### 2.1 工程-需求端映射表

```markdown
| 工程 | 源码路径 | Git 仓库 | 默认分支 | 对应需求端 |
| :--- | :--- | :--- | :--- | :--- |
| order-service | ./packages/order | git@xxx | main | app, admin |
| web-app | ./src/frontend | git@xxx | main | app, h5 |
```

**关键规则**：「对应需求端」列的值决定：
1. analyze 在哪写 `020-specs/{platform}/`
2. split 按哪几个端拆分任务
3. execute 拉什么分支（`feature/Task-{ID}`）

### 2.2 技术栈

```markdown
## 技术栈
### 后端: 语言 / 框架 / 数据库 / 缓存
### 前端: 框架 / 状态管理 / UI 组件
```

### 2.3 Git 分支策略

```markdown
## Git 分支策略
- 默认分支: main
- 任务分支: feature/{Task-ID}
- 发布分支: release/{version}
```

---

## 3. 迭代（Iteration）目录结构

### 3.1 完整结构

```
Iteration-NNN-feature-name/
├── 000-overview/                  ← 进度总览
│   ├── PROJECT_GRAPH.md          ← 任务列表、依赖图
│   └── ARCHITECTURE.md           ← 技术方案（如迭代有特殊架构）
├── 010-requirements/              ← 需求文档（按功能而非按端）
│   ├── sources/                  ← 原始 PRD/Word（可选）
│   ├── assets/                   ← 共享素材
│   │   ├── prd/                  ← PRD 提取的图片
│   │   ├── prototypes/           ← 产品原型截图
│   │   └── designs/              ← UI 设计稿
│   ├── {feature-1}/README.md     ← 需求一（描述所有涉及的端）
│   ├── {feature-2}/README.md     ← 需求二
│   └── ...                       ← 不限目录结构，analyze 递归扫描
├── 020-specs/                     ← analyze 输出（按端拆开）
│   ├── {platform-1}/             ← 端目录（由 CONSTITUTION 定义）
│   │   ├── ANALYSIS.md           ← 合并分析报告
│   │   ├── {feature-1}.md        ← 该功能在该端的分析
│   │   └── {feature-2}.md
│   ├── {platform-2}/
│   └── ...
├── 030-tasks/                     ← 所有开发任务
│   ├── Task-001-{platform}-{feature}/
│   │   ├── REQ.md / TECH.md / TASK.md
│   │   ├── .issues.md            ← 问题记录 + 决策追踪
│   │   └── .needs-retry           ← 执行失败标记
│   └── ...
└── STAFFING.md                    ← 人员排期配置
```

### 3.2 目录编号

| 编号 | 步长 | 含义 |
|:--:|:--:|------|
| 000 | - | 总览信息 |
| 010 | 10 | 输入层（需求） |
| 020 | 10 | 分析层（规约） |
| 030 | 10 | 任务层（开发） |
| 050 | 20 | 导出层（dashboard/spec2doc/retro 产出）预留 |
| 060 | 10 | 日志层（plan/schedule/execute 记录）预留 |

### 3.3 核心原则

**需求按功能组织，分析按端拆分，任务按端+功能创建**。

```
文档阶段：       010-requirements/{feature}/   ← 产品描述登录功能
分析阶段：       020-specs/app/user-auth.md    ← APP 端要做什么
               020-specs/admin/user-auth.md   ← 管理端要做什么
实现阶段：       030-tasks/Task-001-app-auth/   ← APP 端实现
               030-tasks/Task-002-admin-auth/  ← 管理端实现
```

---

## 4. 核心命令流水线

### 4.1 完整链路

```
init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc
```

### 4.2 各阶段职责

| 阶段 | 输入 | 操作 | 输出 |
|------|------|------|------|
| **init** | - | 创建项目结构 + CONSTITUTION + AI-RULES | `.speccore/` + `Iteration-sample/` |
| **doc2spec** | Word/Markdown PRD | pandoc 转换 + 图片提取 | `010-requirements/{feature}/README.md` |
| **analyze** | 010-requirements/ 所有 .md | CONSTITUTION 映射平台 → 递归扫描 → 分端分析 | `020-specs/{platform}/{feature}.md` |
| **split** | 020-specs/ 各端分析 | 扫描 020-specs/ 子目录获取平台 → 解析 h2/h3 → 自动分端 | `030-tasks/Task-NNN/` |
| **plan** | 030-tasks/ + STAFFING | 排序/分批/分配 | `plan.json` |
| **execute** | Task REQ.md + TECH.md | 生成代码 + 检查清单 + .issues.md | 源码 + 验证 |
| **pr** | git branch | 创建 PR + 描述 | Git PR |
| **done** | Task 完成 | 归档 + 写 GLOBAL/INDEX | 更新全局摘要 |
| **spec2doc** | 020-specs/ | 导出 Word/PDF/HTML | 文档 |

### 4.3 错误处理与重试

```
execute --all
  ↓ 部分失败
  ↓ Task-xxx/.issues.md  ← 问题清单 + 决策记录
  ↓ Task-xxx/.needs-retry ← 失败标记
  ↓ 终端: "💡 修复后: speccore execute --resume"

speccore execute --resume  ← 自动扫描 .needs-retry 续跑
```

### 4.4 回顾复盘

```bash
speccore retro --task Task-001          # 单个任务
speccore retro --all                    # 当前迭代全部
speccore retro --all --owner 张三        # 按人筛选
speccore retro --all --type bugfix        # 按类型筛选
```

---

## 5. AI 工具集成

### 5.1 三层保护

| 层 | 文件 | 作用 |
|------|------|------|
| Skill | `.agents/skills/*/SKILL.md` | TRAE 自动加载的行为指令 |
| AI-RULES | `.speccore/AI-RULES.md` | 所有工具通用规则 |
| 命令模板 | `.trae/commands/spec-*.md` | 参数提示 + `${1|选项|}` 交互 |

### 5.2 平台差异

| 平台 | Skill | 推荐用法 |
|------|:--:|------|
| **WorkBuddy** | ✅ | `/spec:ask "用户原话"` — 引擎路由，不会被截胡 |
| **TRAE/Qoder** | ✅ | 精确命令，不用 ask：`/spec:iteration create` → `/spec:doc2spec` → `/spec:analyze` |

---

## 6. 命名规范

### 6.1 命名格式

| 类型 | 格式 | 示例 |
|------|------|------|
| 迭代 | `Iteration-{自增ID}-{slug}` | `Iteration-001-ecommerce` |
| 任务 | `Task-{自增ID}` | `Task-001` |
| 迭代目录 | 3位数字步长10的英文名 | `000-overview`, `010-requirements` |
| 需求端 | 小写英文缩写 | `app`, `h5`, `miniapp`, `admin` |
| 迭代 slug | 中文→拼音首字母 | `电商平台V1` → `v1` |

### 6.2 Git 分支

```
feature/Task-{ID}   ← CONSTITUTION 中 Git 分支策略定义
```

---

## 7. 当前版本状态

| 版本 | 日期 | 关键变更 |
|------|------|------|
| v5.27.25 | 2026-08-06 | 强化 TRAE skill 反绕过、pandoc 多路径检测 |
| v5.27.26 | 2026-08-07 | 需求按功能组织、analyze 按需求×端输出、split 扫描 020-specs 子目录 |

> **最后更新**: 2026-08-07
