---
name: speccore-router
description: >
  智能意图路由器。从自然语言识别意图 → 匹配 Skill → execute_command 执行。
  核心原则：必须直接执行，决不输出命令文本。唯一下例外："只看不跑"。
  Use when user input is ambiguous or doesn't match any specific Skill trigger.
allow-tools: ["Bash", "Read", "Write", "Edit"]
---

# Speccore Router — 意图识别 & 执行

## ⛔ 最高优先级：用户意图优先于效率判断

当用户说"重新/re-analyze/再分析/重跑"时：**禁止检查时间戳、禁止说"无变更"、直接执行用户要求的全部操作**。只可以确认"是否覆盖旧结果"，不可以拒绝执行。
## 🚫 禁止

- 禁止输出命令文本给用户复制粘贴
- 禁止在 AI 上下文中问'是否执行以下命令'
- 禁止不调用 execute_command 只展示 bash 语句
- 唯一例外: 用户明确说'只看不跑'

# SpecCore Router — 智能意图路由器

> **定位**：从用户自然语言识别意图，提取参数，**用 execute_command 自动执行** CLI 命令。
> 
> **核心原则**：你在 AI 上下文中，**必须直接执行**，决不要把命令文本输出给用户复制粘贴。
> **唯一例外**：用户明确要求"只看不跑"才输出而不执行。

---

## 工作流程

```
用户输入自然语言
        │
        ▼
┌───────────────────────────────────────┐
│ 1. 意图识别                            │
│    关键词匹配 + 上下文推断 + 参数提取   │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ 2. 参数校验                            │
│    必需参数 → 缺失时追问用户            │
│    可选参数 → 智能推断默认值            │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ 3. 执行                                │
│    简单意图 → 直接 execute_command 执行 │
│    复杂意图 → speccore ask "描述"      │
│    模糊意图 → 追问确认                  │
└───────────────┬───────────────────────┘
                │
                ▼
        执行成功 → 展示结果
                → 扫描 speccore-*.html 列出 file:// 链接
        执行失败 → 错误处理
```

---

## 完整意图映射表

### 项目初始化
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 初始化项目 | mode? | `speccore init` |
| 初始化 SpecCore | mode?, tool? | `speccore init --interactive` |
| 重新初始化 | - | `speccore init --force` |
| 升级命令文件 | - | `speccore update` |
| 适配 {tool} 工具 | tool={tool} | `speccore init --tool={tool}` |

### 迭代管理
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 创建迭代/新建迭代 {name} | name, topic**, owner? | `speccore iteration create -n {name} --topic {topic} --owner {owner}` |
| 创建 Sprint {n} | name, topic**, owner? | `speccore iteration create -n "Sprint-{n}" --topic {topic} --owner {owner}` |
| 查看迭代列表 | - | `speccore iteration list` |
| 切换到迭代 {name} | name | `speccore context --set --iteration {name}` |
| 重命名迭代 {old} → {new} | old, new | `speccore rename --iteration {old} {new}` |
| 删除迭代 {name} | name | `speccore delete --iteration {name}` |
| 查看当前迭代 | - | `speccore context --show` |

### 文档导入（doc2spec — AI双路验证）
| 用户说法 | 提取参数 | CLI 命令 / 行为 |
| :--- | :--- | :--- |
| 导入需求 {file} | file, iter | `speccore doc2spec -f {file} --iter {iter}` |
| 导入需求 {file} 到 {iter} | file, iter | `speccore doc2spec -f {file} --iter {iter}` |
| 把 PRD 转成 Spec | file? | **激活 spec-doc2spec Skill → AI双路交叉验证** |
| Word 转需求文档 | file?, iter? | **激活 spec-doc2spec Skill** |
| 批量导入需求 {files} | files=逗号分隔 | `speccore doc2spec --files "{files}"` |
| 分析这个 PRD 文档 | file | **激活 spec-doc2spec Skill → 完整AI+Pandoc流程** |
| 帮我看看这个需求文档 | file | **激活 spec-doc2spec Skill** |

### 文档导出（spec2doc — AI排版）
| 用户说法 | 提取参数 | CLI 命令 / 行为 |
| :--- | :--- | :--- |
| 导出文档 | iter?, format? | `speccore spec2doc -i {iter} -o {name}.{format}` |
| 生成 Word/PDF | iter?, format | **激活 spec-spec2doc Skill → AI排版+验证** |
| 导出 {iter} 的文档 | iter, format? | `speccore spec2doc -i {iter} -o {name}.docx` |
| 生成交付文档 | iter? | **激活 spec-spec2doc Skill → 完整出版流水线** |
| 打包技术文档 | iter? | **激活 spec-spec2doc Skill** |
| 导出全部 Spec | iter? | `speccore spec2doc -i {iter} --all -o {name}.docx` |

### 需求分析
| 用户说法 | 提取参数 | AI 上下文（需宿主AI交互） |
| :--- | :--- | :--- |
| 分析需求/检查需求 | iter?, task? | `speccore analyze -I {iter}` |
| 分析 {iter} 的需求 | iter | `speccore analyze -I {iter}` |
| 分析 {task} | iter?, task | `speccore analyze -I {iter} --task {task}` |
| 做需求分析 | iter? | `speccore analyze -I {iter}` |
| 评审需求 | iter? | `speccore analyze -I {iter}` |

### 任务拆分
| 用户说法 | 提取参数 | AI 上下文（需宿主AI交互） |
| :--- | :--- | :--- |
| 拆分任务/拆解需求 | iter, owner? | `speccore iteration split -I {iter}` |
| 分配任务 | iter, owner? | `speccore iteration split -I {iter} --owner {owner}` |
| 拆分 {iter} | iter | `speccore iteration split -I {iter}` |
| 生成任务列表 | iter | `speccore iteration split -I {iter}` |

### 执行开发
| 用户说法 | 提取参数 | AI 上下文（需宿主AI交互） |
| :--- | :--- | :--- |
| 执行 {task}/开发 {task} | task | `speccore execute -t {task} --force` |
| 执行全部/全部开发 | - | `speccore execute --all --force` |
| 继续执行/断点续跑 | - | `speccore execute --resume` |
| 重试失败的任务 | - | `speccore execute --resume` |
| 执行 {task} 并自动修复 | task | `speccore execute -t {task} --force --auto-fix` |
| 批量执行 {iter} | iter | `speccore execute -i {iter} --all --force` |

### PR / 代码提交
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 创建 PR/提 PR | task? | `speccore pr --task {task}` |
| 提交 {task} 的 PR | task | `speccore pr --task {task}` |
| 推代码 | task? | `speccore pr --task {task}` |

### 任务完成
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 完成 {task}/归档 {task} | task | `speccore done --task {task}` |
| 收尾/标记完成 | task? | `speccore done --task {task}` |
| 验收通过 {task} | task | `speccore done --task {task}` |

### 需求变更
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 需求变更/改需求 "{desc}" | desc, task? | `speccore change "{desc}" --task {task}` |
| {task} 需求变了 "{desc}" | task, desc | `speccore change "{desc}" --task {task}` |

### 治理与质量
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 校验/验证 | iter? | `speccore validate -I {iter}` |
| 合规检查 | iter? | `speccore validate -I {iter}` |
| 搜索 "{keyword}" | keyword | `speccore search "{keyword}"` |
| 全局搜索 "{keyword}" | keyword | `speccore search "{keyword}" --global` |
| 追溯 {req} | req | `speccore track --req {req}` |
| 影响分析 {req} | req | `speccore impact --req {req}` |

### 进度查看
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 进度/仪表盘 | scope? | `speccore dashboard --scope global` |
| 全局进度 | - | `speccore dashboard --scope global` |
| 迭代进度 {iter} | iter | `speccore dashboard -i {iter}` |
| 项目名片 | - | `speccore welcome` |
| 帮助 | - | `speccore help` |
| 当前状态 | - | `speccore context --show` |
| 状态面板 | - | `speccore status` |

### 回顾与复盘
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 回顾 {task}/复盘 {task} | task | `speccore retro --task {task}` |
| 全部回顾 | - | `speccore retro --all` |
| {owner} 的工作回顾 | owner | `speccore retro --owner {owner}` |
| {type} 类型的回顾 | type | `speccore retro --type {type}` |

### 智能级联
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 智能级联/全流程推进 | - | `speccore dev` |
| 推进项目/继续开发 | - | `speccore dev` |
| 全自动推进 | - | `speccore dev --auto` |

### 全量层管理
| 用户说法 | 提取参数 | CLI 命令 |
| :--- | :--- | :--- |
| 导入源码 {project} | project, path?, type? | `speccore import --project {project}` |
| 全局状态 | - | `speccore global-status` |
| 同步到全局 | iter? | `speccore sync-global --iteration {iter}` |
| 从全局创建迭代 | project? | `speccore iteration-from-global --project {project}` |

---

## 参数提取策略

### 迭代名 (--iter / -I)
```
优先级：
1. 用户明确说出 "Q1"、"Sprint-3"、"第2期" → 直接使用
2. 从 context.json 读取 currentIteration
3. 遍历 Iteration-*/ 目录，展示列表让用户选择
4. 追问："请指定迭代名称"

格式处理：
- "Q1" → 保持 "Q1"（CLI 自动加 Iteration- 前缀）
- "第2期" → 查找匹配的迭代目录
- "当前迭代" → 从 context.json 读取
```

### 任务编号 (--task / -t)
```
优先级：
1. 用户明确说出 "Task-001"、"任务1"、"第3个任务"
2. 从 context.json 读取 currentTask
3. 读取 PROJECT_GRAPH.md 展示任务列表
4. 追问："请指定任务编号"

格式处理：
- "001" → "Task-001"
- "task1" → "Task-001"
- "第3个" → 按 PROJECT_GRAPH.md 顺序取第3个
```

### 责任人 (--owner)
```
优先级：
1. 用户明确说出人名（张三、李四）
2. 从 context.json 读取 currentAssignee
3. 读取 STAFFING.md 自动分配
4. 从 TEAM.md 读取成员列表，询问用户
```

### 文件路径 (-f)
```
优先级：
1. 用户明确提供的完整路径或相对路径
2. 用户拖入/上传的文件（取系统路径）
3. 在项目根目录搜索匹配的文件名
4. 追问："请提供文件路径"
```

---

## 复杂意图处理

当用户意图无法直接映射为单一命令时，启动 `speccore ask` 引擎：

### 多步骤意图
```
"帮我完成从需求分析到代码生成的整个流程"
→ speccore ask "完成需求分析到代码生成的完整流程"
```

### 定时/批量意图
```
"每天晚上8点检查所有迭代的进度"
→ 告知用户定时调度暂不支持，改为立即执行：speccore ask "检查所有迭代进度"
```

### 条件意图
```
"如果 Task-001 完成了就执行 Task-002"
→ speccore ask "条件执行：Task-001完成后执行Task-002"
```

### 跨迭代意图
```
"比较 Q1 和 Q2 的需求差异"
→ speccore ask "比较 Q1 和 Q2 的需求差异"
```

---

## 追问模板

| 场景 | 追问内容 |
| :--- | :--- |
| 迭代名缺失 | "请指定迭代名称（如：Q1, Sprint-3），当前迭代是 {current}。" |
| 任务号缺失 | "请指定任务编号（如：Task-001），当前任务列表：[列出]。" |
| 责任人缺失 | "请指定责任人，团队可选：[从 TEAM.md 读取]。" |
| 文件缺失 | "请提供需求文档的路径，或拖入文件。" |
| 参数歧义 | "你的意思是 [A] 还是 [B]？" |
| 命令不存在 | "Speccore 没有此命令。你可能想用的是：[建议]。是否尝试 speccore ask？" |
| 未初始化 | "项目未初始化，正在自动执行 speccore init…" → execute_command |
```

---

## 错误处理

| 用户说法 | 处理方式 |
| :--- | :--- |
| 说了一个不存在的命令 | 用 speccore ask 作为 fallback |
| 参数模糊不能确定 | 追问确认，提供选项 |
| 想做的事情没有映射 | 用 speccore ask 作为通用入口 |
| 项目未初始化 | 自动执行 speccore init |

---

## Prompt/Apply 模式映射

> **核心规则**: AI 上下文中，识别意图后**直接用 execute_command 执行对应 CLI 命令**。提示词模式(--prompt)仅在不支持 AI 的终端用户使用。

| 用户意图 | --prompt 命令 | --apply/--response |
| :--- | :--- | :--- |
| 导入需求 {file} | `speccore doc2spec --prompt -f {file}` | `--response '...'` |
| 分析 {iter} | `speccore analyze --prompt -I {iter}` | `--apply '...'` |
| 拆分 {iter} | `speccore iteration split --prompt -I {iter}` | `--response '...'` |
| 生成计划 {iter} | `speccore plan --prompt -I {iter}` | `--response '...'` |
| 执行/开发 {task} | `speccore execute --prompt -t {task}` | `--response '...'` |
| 创建 PR {task} | `speccore pr --prompt -t {task}` | `--response '...'` |
| 完成/归档 {task} | `speccore done --prompt -t {task}` | `--response '...'` |
| 导出文档 {iter} | `speccore spec2doc --prompt -I {iter}` | `--apply '...' -o {file}` |
| 迭代不存在 | 列出现有迭代，询问是否创建新迭代 |
