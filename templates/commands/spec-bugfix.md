---
name: spec-bugfix
aliases: [spec-bf, spec-fix]
description: 🐛 快速 Bug 修复：用户输入 Bug 描述，AI 自动完成修复全流程
category: SpecCore
intent:
  triggers:
    keywords: [修复, 解决, bug, 问题, 报错, 错误, 超时]
    patterns:
      - "修复(.*)问题"
      - "修复(.*)bug"
  params:
    - name: desc
      extract: "desc"
      required: true
      description: "Bug 描述"
  examples:
    - "修复登录超时问题"
    - "修复首页加载缓慢"
    - "解决支付回调丢失"
---
# /spec-bugfix - 快速 Bug 修复

## 命令说明
用户输入 Bug 描述，AI 自动完成：创建 Bug 修复任务 → 根因分析 → 执行修复 → 验证 → 审查。

## 使用方式
```bash
/spec-bugfix 登录接口超时，错误率3%
/spec-bugfix --desc="登录接口超时，错误率3%"
/spec-bugfix --task=Task-005
/spec-bugfix --severity=high
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `<自然语言描述>` | 是* | 直接输入 Bug 描述 | `/spec-bugfix 登录超时` |
| `--desc=<描述>` | 是* | Bug 描述 | `/spec-bugfix --desc="登录超时"` |
| `--task=<Task编号>` | 否 | 关联已有 Task | `/spec-bugfix --task=Task-005` |
| `--severity=<级别>` | 否 | 严重程度（low/medium/high/critical） | `/spec-bugfix --severity=high` |

> *注：`<自然语言描述>` 和 `--desc` 必须至少提供一个。

## AI 执行流程

1. 分析 Bug 描述，确定严重程度
2. 创建 Bug 修复任务（类型为 bugfix）
3. 根因分析（检查代码、日志、复现步骤）
4. 执行修复
5. 验证修复（回归测试）
6. 审查产出

## 输出示例
```markdown
🐛 Bug 修复完成！

📋 问题分析：
- 严重程度：high
- 问题描述：登录接口超时，错误率3%
- 根因：Redis 连接池耗尽

🔧 修复内容：
- 增加连接池大小
- 增加超时重试机制
- 增加连接池监控

✅ 验证结果：通过
- 错误率从 3% 降至 0.1%
- 响应时间从 500ms 降至 120ms
```
