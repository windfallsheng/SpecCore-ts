---
name: spec-execute
description: 路由到 speccore ask 引擎
allowed-tools: ["Bash"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。

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

### 步骤 3：批次完成后重新开始对话
当 Prompt 输出中包含 `[SPECCORE_BATCH_COMPLETE]` 时：
1. 当前对话的批次已完成
2. **必须开始新的对话**
3. 在新对话中执行提示的命令继续下一批次

### 为什么需要批次执行？
- 每个任务的 Prompt + AI 回复会累积在对话上下文中
- 3-5 个任务后，上下文可能接近极限
- 批次执行通过重置对话上下文，确保每个批次都有充足的上下文空间
