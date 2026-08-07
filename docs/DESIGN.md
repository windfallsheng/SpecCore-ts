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
```

---

## 3. 迭代目录结构

```
Iteration-NNN-name/
├── 000-overview/                  ← 进度总览
├── 010-requirements/              ← 按功能组织（非按端）
│   ├── sources/                  ← 原始 PRD
│   ├── assets/{prd,prototypes,designs}/
│   └── {feature}/README.md       ← 每个需求一份，描述所有端
├── 020-specs/                     ← analyze 按端输出
│   └── {platform}/{feature}.md
├── 030-tasks/                     ← 所有开发任务
│   └── Task-NNN-name/
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
分析:  020-specs/app/user-auth.md    +   020-specs/admin/user-auth.md
任务:  030-tasks/Task-001-app-auth/  +   030-tasks/Task-002-admin-auth/
```

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
| plan | 任务列表 + STAFFING | `plan.json` |
| execute | REQ.md + TECH.md → AI 生成代码 | 源码 + .issues.md |
| pr | git branch | Git PR |
| done | Task 完成归档 | GLOBAL/INDEX 更新 |
| spec2doc | 020-specs/ | Word/PDF/HTML |

### 错误处理

```
execute --all → 部分失败 → .issues.md + .needs-retry → --resume 续跑
```

### 回顾复盘

```bash
speccore retro --task Task-001        ← 单个
speccore retro --all                  ← 全部
speccore retro --all --owner 张三     ← 按人
speccore retro --all --type bugfix    ← 按类型
```

---

## 5. Skill + CLI 架构（OpenSpec 模式）

### 5.1 核心理念

**AI 只拼命令，不执行命令。**

```
用户自然语言 → AI 识别意图 → 拼出 CLI 命令文本 → 用户终端执行
                                     ↑
                               AI 到此为止，不参与执行
```

| | 旧（Slash Command） | 新（Skill + CLI） |
|------|:--:|:--:|
| AI 角色 | 理解并执行 | 只理解，只输出命令文本 |
| 执行者 | 宿主 AI | 终端 Shell |
| 被截胡 | 经常 | 不会（Shell 执行代码） |
| 复杂编排 | AI 自行决定 | fallback → `speccore ask "..."` → ask 引擎 |

### 5.2 路由器 Skill

统一入口 `.agents/skills/speccore-router/SKILL.md`，20+ 意图映射：

| 用户说 | 输出 |
|------|------|
| "开发 Task-001" | `speccore execute -t Task-001 --force` |
| "分析 Q1" | `speccore analyze -I Q1` |
| "拆分任务" | `speccore iteration split -I Q1` |
| "查看进度" | `speccore dashboard` |
| 复杂意图 | `speccore ask "用户原话"` ← fallback |

### 5.3 ask 引擎两大模式

| 模式 | 场景 | 调用方式 |
|------|------|------|
| **简单路由** | 关键词匹配 → 拼 CLI | 路由器 Skill |
| **复杂编排** | plan + schedule + 分批 | fallback → CLI `speccore ask "..."` → 4 模式引擎 |

### 5.4 Skill 行为规范

```markdown
**OUTPUT a CLI command, do NOT execute.**

识别用户意图，提取参数，输出 CLI 命令文本。
参数缺失时追问，无法匹配时 fallback 到 speccore ask。
```

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
├── .qoder/commands/spec/  ← Qoder 斜杠命令
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
| Qoder | `.qoder/rules/` + `.qoder/commands/` | ✅ |
| TRAE | `.agents/skills/` + `.trae/commands/` | ✅ |

---

## 7. 调度与守护进程

调度和守护是 SpecCore CLI 自身的 TypeScript 功能，与宿主 AI 无关。

```
speccore schedule create --at "20:00" --all
  → 写入调度队列

speccore schedule daemon start
  → 启动 Node.js 守护进程

到点: daemon → speccore execute → CLI 调 AI 生成代码 → 写文件
```

| 环节 | 控制者 | 可被忽略 |
|------|------|:--:|
| 调度写入 | CLI | ❌ |
| 到点触发 | CLI 守护进程 | ❌ |
| AI 代码生成 | CLI 主动调 AI | ❌ |

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

> **最后更新**: 2026-08-07
