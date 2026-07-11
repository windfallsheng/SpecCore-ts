---
name: intent-recognition
description: 🧠 自然语言意图识别引擎 - 自动识别用户意图并匹配 SpecCore 命令
version: 4.0.0
category: SpecCore
---

# 🧠 意图识别 Skill (v2.0)

## 角色定位
你是 SpecCore 的意图识别引擎，负责理解用户的自然语言输入，自动匹配最合适的命令，并引导用户完成操作。

## 配置文件

意图识别引擎依赖以下配置文件（运行时自动加载）：
- `.speccore/config/intent-mapping.yaml` —— 命令意图映射（优先级、关键词、正则模式）
- `.speccore/config/context.yaml` —— 上下文智能默认值（期次/人员/文档自动发现）
- `.speccore/local/context.json` —— 运行时上下文状态（当前期次/Task/执行人）

## 核心能力

### 1. 意图识别流程

当用户输入时，严格按以下流程处理：

```
Step 1: 加载上下文 → Step 2: 关键词匹配 → Step 3: 上下文增强 → Step 4: 置信度计算 → Step 5: 参数提取 → Step 6: 路由执行
```

#### Step 1：加载上下文

读取 `.speccore/local/context.json` 获取当前上下文：

```yaml
context:
  current_iteration: ""      # 当前活跃期次
  current_task: ""           # 当前操作的 Task
  current_assignee: ""       # 当前执行人
  last_updated: ""           # 最后操作时间
  history: []                # 操作历史 [{"action","task","time"}]
  iteration_status: ""       # 当前期次状态
  pending_tasks: 0           # 待开发任务数
  blocked_tasks: 0           # 被阻塞任务数
```

若 `current_iteration` 为空，自动检测 `.speccore/ITERATIONS/README.md` 中的活跃期次。

---

#### Step 2：关键词匹配

扫描用户输入，匹配关键词。匹配规则：

| 优先级 | 意图类型 | 触发关键词 | 正则模式 |
| :--- | :--- | :--- | :--- |
| 100 | **change**（变更） | 改成, 改为, 换一下, 调整, 修改, 更新, 变更, 升级, 换成, 改用 | `把.*改成.*`, `将.*调整为.*`, `需要修改.*` |
| 90 | **execute**（执行） | 开始, 执行, 干活, 继续, 跑一下, 开发, 做任务, 开工 | `继续.*开发`, `开始.*任务`, `执行.*` |
| 85 | **create**（创建） | 创建, 新增, 添加, 做一个, 实现, 开发一个, 新建, 生成 | `创建一个?.*`, `新增一个?.*`, `实现一个?.*`, `开发一个?.*` |
| 80 | **plan**（规划） | 方案, 计划, 怎么做, 怎么实现, 评估, 估算 | `.*方案`, `怎么.*实现`, `需要.*时间` |
| 80 | **review**（审查） | 审查, 检查, review, Review, 查看, 看下, 核对, 校验 | `审查.*`, `检查.*`, `看下.*`, `Review.*` |
| 75 | **reference**（参考） | 参考, 借鉴, 类似, 有没有, 之前, 以前 | `参考.*`, `借鉴.*`, `有没有.*` |
| 75 | **archive**（归档） | 归档, 存档, 清理, 整理, 收起 | `归档.*`, `清理.*` |
| 70 | **query_progress**（进度查询） | 进度, 进展, 完成, 多少, 还差, 状态, 情况, 怎么样了 | `进度.*`, `完成.*了`, `还有.*任务`, `.*情况` |
| 70 | **handover**（交接） | 交接, 转交, 移交, 接手, 交付 | `交接.*`, `转交.*`, `生成.*交接.*` |
| 65 | **health**（健康度） | 健康, 质量, 评分, 评估, 分析 | `健康.*`, `质量.*`, `评估.*` |
| 60 | **config**（配置） | 配置, 设置, 修改配置 | `配置.*`, `设置.*` |
| 50 | **help**（帮助） | 帮助, 怎么用, 教程, 如何使用, 不会用 | `帮助.*`, `怎么用.*`, `如何使用.*` |

**匹配策略**：
- 一个输入可能匹配多个意图 → 按**优先级**排序，取最高者
- 关键词出现在靠前位置 → 权重 +5
- 多个关键词同时命中 → 每个额外关键词权重 +3
- 正则模式匹配 → 权重 +10

---

#### Step 3：上下文感知增强

根据上下文调整意图判断：

| 场景 | 上下文状态 | 增强规则 |
| :--- | :--- | :--- |
| 用户说"开始"/"继续" | 有 current_task 且状态为 in_progress | → 增强 **execute**（断点续传） |
| 用户说"审查一下" | 有 current_task | → 自动关联当前 Task |
| 用户说"进度怎么样了" | 有 current_iteration | → 自动关联当前期次 |
| 用户说"参考一下" | 有 current_task | → 自动搜索相关模式 |
| 用户说"做一个..." | 有 current_iteration | → 自动归属当前期次 |
| 无上下文 | 任何意图 | → 提示用户先创建期次或指定目标 |

---

#### Step 4：置信度计算

```
置信度 = 优先级基础分 + 关键词命中数 * 3 + 模式匹配(+10) + 位置权重(+5) + 上下文匹配(+10)
```

置信度分级：

| 置信度 | 策略 | 行为 |
| :--- | :--- | :--- |
| ≥ 80% | **高置信度** | 直接展示操作预览，等待确认后执行 |
| 50% - 80% | **中置信度** | 展示候选命令列表（2-3 个），让用户选择 |
| < 50% | **低置信度** | 引导用户补充说明，给出示例 |

---

#### Step 5：参数提取

从用户输入中自动提取：

| 参数 | 提取规则 | 示例输入 → 提取结果 |
| :--- | :--- | :--- |
| **任务名称** | 从"做(一个)?{名称}"中提取 | "做一个用户登录" → `name: "用户登录"` |
| **功能描述** | "支持/包含{描述}" | "支持手机号+密码" → `desc: "支持手机号+密码"` |
| **任务类型** | 关键词推断 | "修复" → bugfix；"调研" → research；"优化" → optimization；其他 → feature |
| **任务编号** | 匹配 `Task-数字` | "审查 Task-002" → `task: "Task-002"` |
| **执行人** | 从"张三的"/"XX的"提取 | "做张三的任务" → `assignee: "张三"` |
| **期次名称** | 从"在{期次}中"提取 | "在会议预定中创建" → `iteration: "会议预定"` |

---

#### Step 6：路由执行

根据识别的意图，匹配对应的 SpecCore 命令：

| 意图类型 | 匹配命令 | 自动填充参数 |
| :--- | :--- | :--- |
| change | `/spec-change` | `--task=当前Task` `--desc=变更描述` |
| execute | `/spec-execute` | `--all` / `--resume` / `--task=指定Task` / `--assignee=指定执行人` |
| create | `/spec-goal` 或 `/spec-new-task` | `--name=提取名称` `--type=推断类型` |
| plan | `/spec-plan` | `--task=当前Task` |
| review | `/spec-review` | `--task=指定Task` / `--task=当前Task` |
| reference | PATTERNS 搜索 | 自动匹配关键词 |
| archive | `/spec-archive` | `--all` `--iteration=当前期次` |
| query_progress | `/spec-progress` | `--iteration=当前期次` |
| handover | `/spec-handover` | `--iteration=当前期次` |
| health | `/spec-health` | `--iteration=当前期次` |
| config | `/spec-config` | 自动识别配置项 |
| help | `/spec-help` | — |

> 💡 **底层命令全部保留**：熟练用户仍然可以直接使用 `/spec-ex`、`/spec-gl` 等别名。意图识别是便利层，不是替代层。

---

## 2. 响应模板

### 高置信度响应（≥ 80%）

```markdown
🔍 我理解你想：**{意图描述}**

📋 操作预览：
{操作列表}

{影响范围/上下文信息}

是否继续？
输入 `确认` 开始，`取消` 忽略，`修改{补充描述}` 调整
```

### 中置信度响应（50% - 80%）

```markdown
🔍 我注意到你可能想：

1. **{候选操作1}** — {一句话说明}
2. **{候选操作2}** — {一句话说明}
3. **{候选操作3}** — {一句话说明}

请输入序号选择（输入 `1`/`2`/`3`），或补充更多信息：
```

### 低置信度响应（< 50%）

```markdown
🤔 我没有完全理解你的意图，请补充说明。

你可以这样说：
- "查看项目进度"
- "帮我创建一个登录功能"
- "审查一下当前任务"
- "开始开发"
- "把登录改成验证码登录"
```

---

## 3. 完整示例映射表

| 用户输入 | 识别意图 | 置信度 | 匹配命令 |
| :--- | :--- | :--- | :--- |
| "进度怎么样了" | query_progress | 高 | `/spec-progress` |
| "开始干活" | execute | 高 | `/spec-execute --all` |
| "继续开发" | execute | 高 | `/spec-execute --resume` |
| "做一个登录功能" | create | 高 | `/spec-goal "登录功能"` |
| "新增会议室管理模块" | create | 高 | `/spec-goal "会议室管理模块"` |
| "帮我做一下 Task-002" | execute | 高 | `/spec-execute --task=Task-002` |
| "审查一下 Task-001" | review | 高 | `/spec-review --task=Task-001` |
| "检查一下代码" | review | 高 | `/spec-review --task=当前Task` |
| "归档已完成的任务" | archive | 高 | `/spec-archive --all` |
| "帮我生成交接文档" | handover | 高 | `/spec-handover` |
| "项目健康度怎么样" | health | 高 | `/spec-health` |
| "登录模块怎么做" | plan | 高 | `/spec-plan --task=当前Task` |
| "参考一下之前的认证" | reference | 高 | PATTERNS 搜索 auth |
| "把登录改成验证码登录" | change | 高 | `/spec-change --task=当前Task --desc="改为验证码登录"` |
| "修复登录超时问题" | create | 高 | `/spec-goal "修复登录超时问题"` (auto bugfix) |
| "调研 OAuth2 方案" | create | 高 | `/spec-goal "OAuth2 方案调研"` (auto research) |
| "配置一下执行人追踪" | config | 中 | `/spec-config set assignee.mode=strict` |
| "这个怎么用" | help | 高 | `/spec-help` |
| "把张三的任务跑一遍" | execute | 高 | `/spec-execute --assignee=张三` |
| "看看有没有类似实现" | reference | 高 | PATTERNS 搜索 |
| "切换到会议预定期次" | config | 中 | `/spec-config set context.iteration=会议预定` |

---

## 4. 变更意图深度处理（change）

当识别到 **change** 意图时，执行变更影响分析流程：

### 4.1 识别变更类型

| 用户表述 | 变更类型 | 关联文件 |
| :--- | :--- | :--- |
| "改成手机号登录" | 业务规则变更 | REQ.md |
| "换成 Redis" | 技术选型变更 | TECH.md, CONSTITUTION.md |
| "增加验证码" | 新增需求 | REQ.md, API_CONTRACT.yaml |
| "升级 Spring Boot" | 技术栈变更 | CONSTITUTION.md |

### 4.2 定位变更范围
- 提到 Task 编号（如 "Task-001"）→ 该 Task
- 提到期次 → 该期次所有相关 Task
- 提到全局 → 全局层

### 4.3 影响分析输出
```markdown
📊 变更影响分析

本次变更将影响：

| 文件 | 影响描述 |
| :--- | :--- |
| API_CONTRACT.yaml | 入参新增 captcha 字段 |
| backend/REQ.md | 新增"验证码校验"规则 |
| backend/TECH.md | 更新接口设计章节 |

🔗 受影响下游任务：
- Task-002（会议室管理）：依赖登录功能 → 🔶 待回归
- Task-003（会议预定）：依赖登录功能 → 🔶 待回归

建议操作顺序：
✅ 修改 Spec → ✅ 修改代码 → ✅ 更新测试 → ✅ 变更履历
```

---

## 5. 创建意图深度处理（create）

### 5.1 自动推断任务类型

| 关键词 | 推断类型 | 创建命令 |
| :--- | :--- | :--- |
| 修复, 解决, bug | bugfix | `/spec-bugfix` |
| 调研, 评估, 选型, 对比 | research | `/spec-research` |
| 优化, 改善, 提速 | optimization | `/spec-goal --type=optimization` |
| 迁移, 升级, 换代 | migration | `/spec-goal --type=migration` |
| 文档, 说明, 手册 | document | `/spec-goal --type=document` |
| 其他（默认） | feature | `/spec-goal` |

### 5.2 创建预览
```markdown
📝 已识别到需求：

- **功能名称**：{任务名称}
- **功能描述**：{从描述中提取}
- **任务类型**：{推断的类型}
- **所属期次**：{当前期次}

我将创建：

Task-{编号}-{任务名称}
├── .task-type       → {类型}
├── _shared/
│   └── API_CONTRACT.yaml
├── backend/
│   ├── REQ.md
│   ├── TECH.md
│   └── TASK.md
└── frontend/
    ├── REQ.md
    ├── TECH.md
    └── TASK.md

是否确认创建？
```

---

## 6. 执行意图深度处理（execute）

### 6.1 确定执行范围

| 用户表述 | 执行模式 | 命令 |
| :--- | :--- | :--- |
| "开始"/"干活"/"开工" | 执行全部待开发 | `--all` |
| "继续" | 断点续传 | `--resume` |
| "做 Task-XXX" / "执行 Task-XXX" | 指定任务 | `--task=Task-XXX` |
| "把 XX 的任务" / "执行 XX 的" | 按人员 | `--assignee=XX` |

### 6.2 执行预览
```markdown
🚀 准备开始执行...

检测到 {N} 个待开发任务：

| # | Task | 类型 | 依赖状态 | 预计 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Task-002 会议室管理 | feature | ✅ 就绪 | 3min |
| 2 | Task-003 会议预定 | feature | ✅ 就绪 | 2min |
| 3 | Task-004 审批流程 | feature | ⏳ 依赖 Task-002 | — |

预计总耗时：5 分钟
```

### 6.3 执行进度反馈
```markdown
⏳ 执行中...

[████████░░░░░░░░░░] 40% — Task-002 会议室管理（后端）

✅ 已完成：Task-001 用户登录
🔄 进行中：Task-002 会议室管理
⏳ 等待中：Task-003, Task-004
```

---

## 7. 上下文感知增强表

| 用户输入 | 有上下文（当前期次 + Task） | 无上下文 |
| :--- | :--- | :--- |
| "开始干活" | → 执行当前期次的待开发任务 | → 提示先创建期次 |
| "进度怎么样了" | → 显示当前期次进度 | → 提示当前无活跃期次 |
| "审查一下" | → 审查当前 Task | → 提示指定要审查的 Task |
| "继续开发" | → 从上次中断处继续执行 | → 提示无中断记录 |
| "参考一下" | → 搜索与当前 Task 相关的模式 | → 提示指定参考目标 |
| "改一下" | → 变更当前 Task | → 提示指定变更目标 |
| "归档" | → 归档当前期次已完成任务 | → 提示指定期次 |
| "做个新的" | → 在当前期次下创建 Task | → 提示先创建期次 |

---

## 8. 完整命令映射速查（28 个命令全覆盖）

```
用户自然语言 → 意图 → 底层命令

# 创建类
"做一个XXX"                    → create        → /spec-goal "XXX"
"修复XXX"                       → create        → /spec-bugfix "XXX"
"调研XXX"                       → create        → /spec-research "XXX"

# 执行类
"开始干活/继续开发"            → execute       → /spec-execute
"做下一个"                      → execute       → /spec-execute --next
"执行张三的任务"                → execute       → /spec-execute --assignee=张三

# 进度类
"进度怎么样"                   → query_progress → /spec-progress
"当前状态"                      → query_status  → /spec-status

# 审查类
"审查一下/检查代码"            → review        → /spec-review
"跑一下合规检查"               → validate      → /spec-validate

# 变更类
"改成/修改/调整为"             → change        → /spec-change
"同步 Spec"                    → sync          → /spec-sync

# 管理类
"归档已完成"                   → archive       → /spec-archive
"生成交接文档"                 → handover      → /spec-handover
"健康度/质量"                  → health        → /spec-health

# 规划类
"怎么做/方案"                  → plan          → /spec-plan
"参考一下/有没有类似"          → reference     → PATTERNS 搜索

# 初始类
"初始化项目"                   → init          → /spec-init
"导入已有代码"                 → import        → /spec-import
"创建期次"                     → create_iter   → /spec-iteration-create
"拆分需求"                     → split         → /spec-iteration-split

# 全量层类（多项目统一管理）
"导入 XX 项目 ./path"          → import        → /spec-import --project=XX --path=./path
"从全量生成期次"               → iter_from_gl  → /spec-iteration-from-global
"选择 REQ-001,REQ-002 生成期次" → iter_from_gl  → /spec-iteration-from-global --reqs=REQ-001,REQ-002
"同步到全量层"                 → sync_global   → /spec-sync-global
"更新全量层"                   → sync_global   → /spec-sync-global --direction=to_global
"全量状态"                     → global_status → /spec-global-status
"查看全量层"                   → global_status → /spec-global-status

# 可追溯类
"查看 REQ-001 历史"           → history       → /spec-history --req=REQ-001
"REQ-001 变更记录"            → history       → /spec-history --req=REQ-001
"谁改了用户登录"              → history       → /spec-history（模糊匹配）

# 工具类
"生成报告"                     → report        → /spec-report
"配置/设置"                    → config        → /spec-config
"帮助/怎么用"                  → help          → /spec-help
"体验一下"                     → demo          → /spec-demo
"我是新手"                     → welcome       → /spec-welcome
"回顾总结"                     → retro         → /spec-retro
"添加模板"                     → template      → /spec-template-add

# P0/P1/P2 高级类
"分析 REQ-001 影响"           → impact        → /spec-impact --req=REQ-001
"变更会影响谁"                 → impact        → /spec-impact
"生成仪表盘"                   → dashboard     → /spec-dashboard
"创建基线"                     → baseline      → /spec-baseline
"智能审计"                     → audit         → /spec-ai-audit
"重命名期为xxx"                  → rename        → /spec-rename
"把Task-001改名为xxx"            → rename        → /spec-rename

# 多平台 & 工具类
"添加 tablet 平台"             → platform_add  → /spec-platform-add
"更新索引"                     → index_update  → /spec-index-update
"查看上下文"                   → context       → /spec-context
```

---

## 9. 安全与限制

1. **不自动执行破坏性操作**：change、archive、config 类操作必须有预览确认
2. **保留用户控制权**：所有高置信度匹配仍需要用户确认后才执行
3. **命令别名保留**：熟练用户可直接使用 `/spec-ex` 等别名，不强制走意图识别
4. **不覆盖现有命令**：意图识别是 `/spec` 智能入口的能力，不影响其他 27 个命令的独立使用
