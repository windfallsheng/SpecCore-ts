# Spec 三层加载机制说明

> 适用版本：v5.17.0+

## 三层 Spec 架构

SpecCore 生成的所有 Spec 文件分为两个用途：**人读**和**程序读**。只有标记了 `spec-rule` 的文件会被 execute 自动解析。

```
Layer 1 — 全局约束（execute 自动注入）
  ✅ CONSTITUTION.md  spec-rule 区块 → 代码规范自动生效
  ✅ TECH_STACK.md    tech-stack 区块 → 技术栈自动检测

Layer 2 — 期次上下文（人类文档，手动查阅）
  📖 00-需求文档/      本期需求总览
  📖 00-技术文档/      架构决策记录
  📖 00-期次总览/      任务依赖图

Layer 3 — Task 执行（execute 核心输入）
  ✅ Task/REQ.md      接口表格 → 生成方法骨架
  ✅ Task/TASK.md     状态更新
  📖 Task/TECH.md     技术方案（人类可读）
```

## 一、Layer 1：全局约束（程序自动解析）

### CONSTITUTION.md → spec-rule 规则注入

在 CONSTITUTION.md 中用 `<!-- spec-rule: xxx -->` 标记的规则，会在 `speccore execute` 时自动注入到生成的代码中。

**标记格式：**

```markdown
<!-- spec-rule: exception-handler -->
- 统一异常：所有 Controller 抛出 BusinessException
- 全局捕获：@ControllerAdvice 处理
<!-- /spec-rule -->
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

## 二、Layer 2：期次上下文（人类文档）

这些文件不参与代码生成，但提供关键的项目信息：

| 文件 | 用途 | 谁看 |
| :--- | :--- | :--- |
| `00-需求文档/REQUIREMENT.md` | 本期要做的所有需求、优先级、里程碑 | PM、开发者 |
| `00-技术文档/ARCHITECTURE.md` | 期次级别的架构决策 | 架构师 |
| `00-期次总览/PROJECT_GRAPH.md` | 任务依赖关系图，决定开发顺序 | 开发者 |

## 三、Layer 3：Task 执行（核心输入）

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

## 四、其他文件（人类文档）

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

## 五、完整开发流程

### 💬 对话式（推荐新用户）

```
1. "我的 Java 项目用 Spring Boot + JPA，异常统一用 ApiException"
   → AI 自动创建 CONSTITUTION.md spec-rule + TECH_STACK.md

2. "创建 Q3 期次"
   → AI 调用 speccore iteration create --name=Q3

3. "创建一个订单管理的 Feature 任务"
   → AI 调用 speccore new-task --name="订单管理"

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
speccore new-task --name="订单管理" --platforms=web,backend

# 3. 写需求文档
vim 期次-Q3/Task-001-订单管理/backend/REQ.md
# | POST | /api/v1/orders | 创建订单 |
# | GET  | /api/v1/orders | 查询列表 |

# 4. 执行（全局规则 + 技术栈自动注入）
speccore execute --task=Task-001 --force
# → Tech Stack: Spring + Vue
# → 生成 Controller: Result<?> create() throw BusinessException()
# → 生成 Vue 组件
```

## 六、备份与回滚

AI 修改任何 Spec 文件前自动创建 `.bak` 备份，防止改坏：

```bash
# 对话回滚
"刚才改的 Task-001 不对，帮我回滚"  → AI 从 .bak 恢复

# CLI 回滚
speccore rollback --task=Task-001 --list       # 查看备份
speccore rollback --task=Task-001 --confirm    # 确认恢复
```

备份存在同目录下（如 `REQ.md.bak`），恢复后自动清理，24 小时后过期。
