---
name: spec-ask
description: >
  SpecCore 意图引擎 — 宿主 AI 语义分析入口。
  所有用户操作走此 Skill，AI 负责：理解意图 → 拼命令 → 确认 → 逐步执行。
  Always invoked via execute_command("speccore ask '用户原话'").
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

# SpecCore Ask — AI 语义分析引擎

## 核心原则

1. **总是先确认再干活** — 理解用户意图后，展示执行计划让用户确认
2. **逐步执行不跳步** — 确认后按步骤逐一执行，每步检查结果
3. **有歧义就问** — 不确定的时候问用户，不要猜
4. **需要 AI 生成内容的命令加 --prompt** — analyze/plan/execute

## 执行流程

```
1. execute_command("speccore ask '用户原话'")
   → 读取输出中的 KB（可用命令列表）和工作流

2. 你是 AI — 根据 KB + 用户输入，自己分析意图
   示例: "分析Q1任务001，列计划，17:30执行" →
     step 1: speccore analyze --prompt -I Q1 --task 001
     step 2: speccore plan --prompt -I Q1 --task 001
     step 3: speccore schedule create -I Q1 --task 001 --at "17:30"

3. 把计划展示给用户:
   ```
   我理解你要:
   1. 分析 Q1 的任务001
   2. 为任务001制定开发计划
   3. 定时 17:30 执行
   
   是否确认？
   ```

4. 用户确认后，逐步执行:
   step 1: execute_command("speccore analyze --prompt -I Q1 --task 001")
     exitCode=10 → 读 SPECCORE_PROMPT → 你生成分析内容 → write back
     exitCode=0  → 继续
   step 2: execute_command("speccore plan --prompt -I Q1 --task 001")
     (同上)
   step 3: execute_command("speccore schedule create -I Q1 --task 001 --at ...")
```

## 关键命令参考

| 命令 | 用途 | 需要 AI |
|:---|:---|:---|
| `analyze --prompt -I <iter> --task <id>` | 分析任务需求 | ✅ --prompt |
| `plan --prompt -I <iter> [--task <id>]` | 制定开发计划 | ✅ --prompt |
| `execute --prompt -I <iter> --task <id>` | 执行开发任务 | ✅ --prompt |
| `schedule create -I <iter> --task <id> --at "HH:MM"` | 创建定时调度 | ❌ |
| `context --set --iteration <name>` | 切换迭代上下文 | ❌ |
| `dashboard` | 查看进度面板 | ❌ |

## 常用工作流

- **分析 + 计划 + 调度**: analyze → plan → schedule
- **分析 + 开发**: analyze → execute
- **修复 bug**: analyze → plan → execute → validate → pr → done
- **批量执行**: plan → schedule → execute
