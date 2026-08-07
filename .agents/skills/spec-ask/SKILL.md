# SpecCore Ask — 万能编排引擎（Universal Orchestrator）

> **角色**: 用户自然语言的唯一入口。识别意图 → 解析参数 → 调用 CLI → 协调 AI → 写回结果 → 推荐下一步。
> **原则**: 一次只推进一步，永远在等待用户确认后才继续。错误时优雅降级，决不静默失败。

---

## 1. 意图分类决策树

```
用户输入
    │
    ├─ 是纯知识问题?（"XXX命令怎么用"/"什么是SpecCore"）
    │   └─ 📖 知识问答模式: 从 KB 匹配 → 返回帮助文本 → 结束
    │
    ├─ 是简单命令?（关键词匹配到 1 个高置信意图）
    │   └─ 🎯 单命令模式 → 解析参数 → 执行 → 总结
    │
    ├─ 包含多步关键词?（"然后"/"再"/"接着"/"最后"）
    │   └─ ⚡ Pipeline 模式 → 拆解步骤 → 逐步确认 → 执行
    │
    ├─ 匹配到多个意图且置信度都接近?
    │   └─ 🤔 歧义消解模式 → 列出候选项 → 让用户选择
    │
    └─ 完全无法匹配?
        └─ 🤷 委派模式 → 输出 speccore ask "原始输入" 给 LLM 推理
```

---

## 2. 知识问答模式（📖 Explain）

```
触发: 问某个命令的用法、概念、流程

执行:
1. 提取核心词（如 "execute" "dashboard" "init"）
2. 匹配 COMMAND_KB
3. 如果匹配到 → 返回: 描述 + 用法 + 参数表 + 示例 + 关联命令
4. 如果没匹配到 → 返回所有命令列表

不需要调用 CLI，纯 Skill 回答。
```

---

## 3. 单命令模式（🎯 Match → Prompt/Apply）

这是最核心的模式。完整流程：

```
Phase 1: 意图识别
  → speccore ask "{用户输入}"  
  → CLI 返回: intent + confidence + extractedParams

Phase 2: 参数解析（三层策略）
  Layer 1: 从 extractedParams 取 → 已有参数的直接用
  Layer 2: 从上下文补充 → 读 context.json 获取当前迭代/任务
  Layer 3: 可用选项展示 → 列出现有迭代/Task/平台 → 让用户选

Phase 3: 构建命令
  → 拼出: speccore <command> --prompt -i <iter> -t <task> ...
  → execute_command 执行

Phase 4: 检查退出码
  → exitCode=0: 无需 AI，确定性操作完成 → 进入 Phase 6
  → exitCode=10: 需要 AI → 进入 Phase 5
  → exitCode=11: 缺少参数 → 回到 Phase 2（已有信息保留）
  → exitCode≠0: 错误 → 进入错误恢复

Phase 5: AI 处理
  → 从 stdout 提取 [SPECCORE_PROMPT]...[/SPECCORE_PROMPT]
  → 提交给宿主 AI 生成内容
  → AI 返回后：
    a. 验证格式: execute 需要 {"files":[...]}，analyze 需要 Markdown
    b. 格式正确 → 继续
    c. 格式错误 → 提示 AI: "请按指定格式返回" → 最多重试 2 次
    d. 2 次仍失败 → 降级: 用 AI 返回的原始内容，直接写入文件
  → execute_command("speccore <command> --response/--apply '$result' ...")

Phase 6: 执行总结
  → 从 stdout 读取执行结果
  → 展示: 写入文件列表、状态变更、质量评分
  → 推荐下一步操作
```

---

## 4. 参数解析三层策略

### Layer 1: extractedParams（从用户输入提取）

| 用户输入 | extractedParams | 说明 |
| :--- | :--- | :--- |
| "分析 Q1" | `{iteration: "Q1"}` | 正则提取 |
| "开发 Task-001" | `{task: "Task-001"}` | 正则提取 |
| "初始化 trae" | `{tool: "trae"}` | 工具名匹配 |

### Layer 2: 上下文自动补充

```
1. 读取 .speccore/local/context.json
   → currentIteration, currentTask
2. 如果参数还未补齐:
   → 扫描 Iteration-*/ 目录 → 获取迭代列表
   → 扫描 030-tasks/Task-*/ → 获取 Task 列表
   → 读取 CONSTITUTION 平台列 → 获取平台列表
```

### Layer 3: 追问用户

```
展示交互式选项（Markdown 格式，适配所有 AI 工具）:

⚠️ 执行 `analyze` 前需确认以下参数:

📋 已确定:
  ✅ 命令: analyze

📋 待确认:
  ❓ 迭代 (--iteration): 
     [1] Q1  [2] Sprint-3  [3] sample
     请选择编号或直接输入迭代名
     
  ❓ 分析深度 (--depth, 可选):
     [1] quick  [2] normal (默认)  [3] deep
     不选择则使用默认值

输入示例: "1, 2" → 迭代=Q1, 深度=normal
```

---

## 5. 退出码处理矩阵

| 退出码 | 含义 | Skill 行为 |
| :--- | :--- | :--- |
| 0 | 成功（确定性操作完成） | 读取 stdout 摘要 → 展示 → 推荐下一步 |
| 10 | 需要 AI 处理 | 提取 [SPECCORE_PROMPT] → 提交 AI → 调 --apply |
| 11 | 缺少参数 | 解析 [SPECCORE_NEEDS_INFO] → Layer 1/2/3 解析 → 重新调用 |
| 128+ | 系统错误 | 展示错误信息 → 建议检查环境 → 提供替代方案 |

---

## 6. AI 响应校验与重试

```
AI 返回后，立即校验:

1. 格式校验:
   execute: /\{"files"\s*:\s*\[/  → 是否包含 files 数组
   analyze: /^#+\s/               → 是否 Markdown 标题格式
   split: /\[\s*\{/               → 是否 JSON 数组
   
2. 内容校验:
   execute: files 数组非空 → 每个元素有 path+content
   analyze: 长度 > 100 字符 → 包含至少 2 个标题
   
3. 校验失败 → 重试:
   第 1 次: 提示 AI "请确保返回格式为: ..."
   第 2 次: 更严格提示 "必须严格按格式返回，否则将使用原始输出"
   第 3 次: 降级处理 — 用原始输出直接写入文件
```

---

## 7. Pipeline 模式（多步编排）

```
用户: "帮我分析 Q1 然后拆分任务再执行开发"

Skill 拆解:
  Step 1: speccore analyze --prompt -I Q1
  Step 2: speccore iteration split --prompt -I Q1
  Step 3: speccore execute --prompt -t Task-001

编排规则:
  1. 每一步执行前: 展示将要执行的命令 → 等待用户确认
  2. 每一步完成后: 展示结果摘要 → 询问是否继续
  3. 任一步失败: 暂停 → 展示错误 → 提供 3 个选项:
     [重试该步] [跳过该步继续] [停止全部]
  4. 中间产物自动传递: Step1→Step2 的 ANALYSIS.md 路径自动传入
```

---

## 8. 歧义消解

```
当多个意图置信度接近时（差距 < 15%）:

用户: "更新项目"

匹配: init(65%) vs change(55%) vs sync(45%)

Skill 展示:
🤔 你的意图可能是以下之一:

[1] 初始化/更新 SpecCore 配置    (speccore init --update)
[2] 变更需求                      (speccore change "...")
[3] 同步代码与 Spec               (speccore sync)

请选择编号，或重新描述你的需求。
```

---

## 9. 跨工具兼容策略

| 工具 | execute_command | stdout 捕获 | 文件读取 | 交互方式 |
| :--- | :--- | :--- | :--- | :--- |
| WorkBuddy | ✅ Bash tool | ✅ 返回值 | ✅ Read tool | 对话+卡片 |
| Claude Code | ✅ BashTool | ✅ | ✅ | 对话 |
| Trae/Qoder | ✅ Terminal | ✅ | ✅ | 对话 |
| Cursor | ✅ Terminal | ✅ | ✅ | 对话 |
| Windsurf | ✅ Terminal | ✅ | ✅ | 对话 |

**原则**: 不用仅支持单一工具的通信方式（如 Qoder 的本地 API），
只用 stdout + exitCode 这种所有工具都支持的标准通道。

---

## 10. 完整交互示例

```
用户: "帮我做登录功能"

Skill:
  🤔 你需要以下信息才能开始:
  📋 请提供 PRD 文档路径，或描述登录功能的需求

用户: "PRD.docx"

Skill:
  ✅ 检测到文件: PRD.docx
  📋 将执行: speccore doc2spec --prompt -f PRD.docx
  
  [执行中...]
  
  ✅ 文档已转换
  📋 下一步: 分析需求 → 拆分任务 → 开发
  是否继续? [继续] [查看文档] [停止]

用户: "继续"

Skill:
  📋 执行: speccore analyze --prompt -I Q1
  
  [执行中... AI 分析完成]
  
  ✅ 分析完成: 发现 6 个 API, 3 个数据模型
  📋 下一步: 拆分为开发任务
  是否继续?

用户: "继续"

Skill:
  📋 执行: speccore iteration split --prompt -I Q1
  
  [执行中...]
  
  ✅ 已拆分为 3 个任务:
    Task-001: 用户认证 (2 API)
    Task-002: 登录页面 (1 API)
    Task-003: Token 管理 (3 API)
  📋 选择要开发的任务: [Task-001] [Task-002] [Task-003] [全部]

用户: "Task-001"

Skill:
  📋 执行: speccore execute --prompt -t Task-001
  
  [AI 生成代码中...]
  
  ✅ Task-001 完成: 3 个文件已写入
  📊 执行总结:
    ✅ AuthController.java
    ✅ AuthService.java
    ✅ users.sql
  💡 推荐下一步:
    → speccore pr --task Task-001
    → 继续执行 Task-002
```
