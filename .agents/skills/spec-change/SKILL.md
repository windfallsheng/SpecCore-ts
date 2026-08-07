---
name: spec-change
description: >
  需求变更管理。联动更新所有关联 Spec，支持口语化输入。
  Use when user says "变更" "改需求" "修改" "change".
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---
# SpecCore Change — 需求变更处理器

> **你负责**: 记录变更 → 分析影响 → 重新生成受影响代码。

## 执行流程

```
1. 记录变更描述 + 关联 Task
2. 分析影响: Read REQ.md → 列出受影响的 API/文件
3. 展示: "⚠️ 影响: 2 个 API, 3 个文件。继续？[是/取消]"
4. 执行: execute_command("speccore execute --prompt -t {task}")
5. 你自己生成修正代码（走 spec-execute 流程）
6. 写入: cat /tmp/resp.json | speccore execute --response - -t {task}
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 10 | 你重新生成受影响的代码 |
| 其他 | [重试/跳过/停止] |
