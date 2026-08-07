# SpecCore Execute — Skill + CLI + AI 协作开发引擎

> **架构**: CLI 准备上下文 → 输出 Prompt → AI 生成代码 → CLI 写回文件
> 
> **核心原则**: CLI 不做代码生成，只做确定性操作（读 Spec、写文件、更新状态）。
> 代码生成完全由宿主 AI 完成。

---

## 执行流水线

```
Skill 调用 CLI                     Skill 获取 Prompt           Skill 调用 AI              Skill 调用 CLI
     │                                  │                        │                          │
     ▼                                  ▼                        ▼                          ▼
┌──────────────┐              ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Phase 1:     │              │ Phase 2:         │    │ Phase 3:         │    │ Phase 4:         │
│ CLI 读 Spec  │──────────────▶│ CLI 输出 Prompt  │───▶│ AI 生成代码      │───▶│ CLI --response   │
│ 并构建Prompt │   stdout      │ (结构化Markdown) │    │ 返回JSON         │    │ 写入文件         │
└──────────────┘              └──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## 详细步骤

### Step 1: Skill 调用 CLI 进入 Prompt 模式
```
命令: execute_command("speccore execute --prompt -t Task-001")

CLI 做的事：
1. 读取 Task-001/REQ.md → 提取 API 定义、数据模型
2. 读取 .speccore/CONSTITUTION.md → 提取技术栈、命名规范
3. 构建结构化 Prompt（Markdown 格式）
4. 输出到 stdout，退出码 10

输出示例：
[SPECCORE_PROMPT]
# 任务: execute — Task-001
## API 接口定义
| 方法 | 路径 | 说明 |
...
## 执行指令
请根据以上 Spec 生成代码...
[/SPECCORE_PROMPT]
```

### Step 2: Skill 捕获 Prompt，交给宿主 AI
```
Skill 通过 execute_command 的返回值捕获 stdout 中的 [SPECCORE_PROMPT] ... [/SPECCORE_PROMPT] 内容。

将完整的 Prompt 内容作为上下文传给宿主 AI。

宿主 AI 的任务：
1. 阅读 Spec 规范（API、数据模型、业务规则）
2. 按技术栈生成代码
3. 返回 JSON 格式：{"files": [{"path": "src/...", "content": "代码"}]}
```

### Step 3: Skill 调用 CLI 写入生成结果
```
命令: execute_command(`speccore execute --response '${JSON.stringify(aiResult)}' -t Task-001`)

CLI 做的事：
1. 解析 AI 返回的 JSON
2. 将每个文件写入指定路径
3. 更新 PROJECT_GRAPH.md 状态
4. 输出写入摘要
```

---

## 完整 Skill 执行示例

```
用户: "开发 Task-001"

Skill 执行流程:
1. execute_command("speccore execute --prompt -t Task-001")
   → stdout 输出 [SPECCORE_PROMPT] ... [/SPECCORE_PROMPT]

2. 提取 Prompt 内容，提交给宿主 AI 生成代码
   → AI 返回: {"files": [...]}

3. execute_command("speccore execute --response '{\"files\":[...]}' -t Task-001")
   → ✅ 3 个文件已写入
```

---

## 输出 CLI 命令

```bash
# 生成 Prompt
speccore execute --prompt -t {task}

# 写入 AI 返回
speccore execute --response '{json}' -t {task}
```
