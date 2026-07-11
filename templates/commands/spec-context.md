---
name: spec-context
aliases: [spec-ctx]
description: 📋 查看当前 Task 的上下文加载状态和 Spec 依赖链
category: SpecCore
intent:
  triggers:
    keywords: [上下文, 环境, 加载状态, 依赖链]
    patterns:
      - "查看上下文"
      - "加载.*状态"
      - "查看.*依赖"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "Task 编号（auto=当前任务）"
  examples:
    - "查看上下文"
    - "查看加载状态"
    - "查看 Task-001 上下文"
---

# /spec-context - 查看上下文加载状态

## 命令说明

查看指定 Task 对应的 Spec 文件加载状态，帮助 AI 在执行前确认需要读取哪些文件。

## 使用方式

```bash
/spec-context
/spec-context --task=Task-001
```

```bash
查看上下文
查看 Task-001 上下文
```

## AI 执行流程

### 第一步：确定 Task

未指定时使用 `context.json` 中的 `current_task`。

### 第二步：扫描 Spec 文件

扫描 Task 目录结构，识别三层 Spec 文件。

### 第三步：输出上下文报告
```markdown
📋 上下文加载状态 — Task-001 用户登录

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 全局层（已加载）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ .speccore/CONSTITUTION.md
  ✅ .speccore/config/platforms.yaml

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 期次层（已加载）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ 00-需求文档/REQUIREMENT.md
  ✅ 00-期次总览/PROJECT_GRAPH.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 任务层
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  _shared/
    ✅ API_CONTRACT.yaml
  backend/
    ✅ REQ.md  ✅ TECH.md  ✅ TASK.md
  frontend/
    web/      ✅ REQ.md  ✅ TECH.md  ✅ TASK.md
    h5/       ✅ REQ.md  ⚠️ TECH.md(空) ✅ TASK.md
    miniapp/  ✅ REQ.md  ✅ TECH.md  ✅ TASK.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 依赖链
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  上游：无
  下游：Task-002 会议室管理

📋 执行前 AI 需加载约 15 个文件
```
