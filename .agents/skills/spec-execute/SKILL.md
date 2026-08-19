---
name: spec-execute
description: >
  执行开发专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（任务状态检查、代码模式读取、上下文准备），
  参数缺失时输出交互式提示（参数说明 + 使用示例）。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-execute — 执行开发（专属逻辑）

> **定位**：`/execute` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力，只在调用 ask 之前做参数校验和上下文准备

---

## 调用方式

```
/execute [参数]
/execute -t Task-001
/execute -I Iteration-001 --all
```

---

## 执行流程

```
用户输入 /execute [参数]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 参数提取                        │
│ 从用户输入提取 iteration/task/all 等     │
└───────────────┬───────────────────────┘
                │
        参数缺失？
                │
        是 ──► 输出交互式提示
                │
        否 ──► 继续
                │
                ▼
┌───────────────────────────────────────┐
│ Step 2: 前置校验                        │
│ - 任务是否存在？                        │
│ - 上游文档是否有更新？                  │
│ - 代码模式读取（.speccore/PATTERNS/）   │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 3: 调用 speccore ask               │
└───────────────────────────────────────┘
```

---

## Step 1: 参数提取

| 参数 | 短名 | 长名 | 必填 | 说明 |
|:---|:---|:---|:---|:---|
| iteration | -i | --iteration | 否 | 目标迭代名 |
| task | -t | --task | 否 | 指定任务（与 --all 互斥）|
| all | -a | --all | 否 | 全部待执行任务 |
| force | -f | --force | 否 | 跳过确认直接执行 |
| resume | -r | --resume | 否 | 断点续跑 |
| batch-size | -b | --batch-size | 否 | 每批任务数（默认 3）|
| verify | -v | --verify | 否 | 执行后自动验证 |
| agent | - | --agent | 否 | 外部 AI 工具 |

---

## Step 2: 参数缺失 → 交互式提示

```
🔨 speccore execute — 执行开发

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 当前环境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
迭代: Iteration-001-meeting-system（从 context.json 读取）
待执行任务: 3 个（Task-001, Task-002, Task-003）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -I, --iteration <name>    目标迭代（默认: 当前迭代）
  -t, --task <id>           指定任务（如 Task-001）
  -a, --all                 全部待执行任务
  -f, --force               跳过确认直接执行
  -r, --resume              断点续跑（从上次中断处继续）
      --batch-size <n>      每批任务数（默认 3）
      --verify              执行后自动运行测试验证
      --agent <tool>        外部 AI 工具（copilot/claude/cursor/trae/qoder）
      --ignore-upstream-update  跳过上游变更检测

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /execute -t Task-001                    # 执行单个任务
  /execute --all                          # 执行全部待完成任务
  /execute --all --force                  # 全部执行，跳过确认
  /execute --resume                       # 断点续跑
  /execute --all --batch-size 5           # 每批 5 个任务
  /execute -t Task-001 --verify           # 执行后自动验证

请补充参数后重新调用。
```

---

## Step 3: 前置校验

### 3.1 检查任务是否存在
```bash
# 扫描 030-tasks/ 目录
# 如果 Task 不存在 → 提示用户
```

### 3.2 检查任务状态
```bash
# 读取 Task/.meta/status
# 如果状态为 done → 提示用户是否重新执行
# 如果状态为 pending → 正常执行
```

### 3.3 上游变更检测
```bash
# 比较 020-specs/ 和 Task/00-specs/ 的 mtime
# 如果有更新 → 提示用户建议重新拆分
```

### 3.4 读取代码模式
```bash
# 读取 .speccore/PATTERNS/ 中匹配的代码模式
# 为 AI 提供参考代码片段
```

---

## Step 4: 调用 speccore ask

```bash
execute_command("speccore ask '执行 Task-XXX 的开发...'")
```

> ⚠️ 最终仍然调用 `speccore ask`，不要绕过 ask 引擎。

---

## 📦 批次执行模式（防止上下文溢出）

当执行多个任务时，使用批次模式避免 AI 上下文耗尽：

### 步骤 1：获取任务清单
```bash
speccore execute --list-pending -i <迭代名> --batch-size 3
```
输出 JSON 格式的任务清单，包含批次分组信息。

### 步骤 2：按批次执行
对于每个批次中的任务：
```bash
# 1. 获取 Prompt
speccore execute --prompt --task=<任务ID> -i <迭代名> --batch-size 3

# 2. 根据 Prompt 生成代码

# 3. 写入文件
speccore execute --response '<代码JSON>' --task=<任务ID> -i <迭代名>
```

### 步骤 3：批次完成后自动续批
当 Prompt 输出中包含 `[SPECCORE_CONTINUE: <path>]` 时：
1. 当前对话的批次已完成
2. **必须开始新的对话**
3. 在新对话中，先读取 `<path>` 文件恢复上下文（约 1K tokens，包含已完成任务摘要、待执行任务、依赖关系）
4. 然后执行提示的命令继续下一批次

> 💡 "文件即记忆"机制：每个任务完成后，CLI 自动将进度、产出摘要、依赖关系写入摘要文件。
> 新会话只需读取这个文件（~1K tokens）就能恢复全局视角，无需重新扫描全部文件。

### 为什么需要批次执行？
- 每个任务的 Prompt + AI 回复会累积在对话上下文中
- 3-5 个任务后，上下文可能接近极限
- 批次执行通过重置对话上下文，确保每个批次都有充足的上下文空间
