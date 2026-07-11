---
name: spec-goal
aliases: [spec-gl, spec-feat]
description: 🎯 完整需求交付：用户输入自然语言需求，AI 自动完成全流程
category: SpecCore
intent:
  triggers:
    keywords: [完成需求, 实现功能, 交付功能, 完整实现]
    patterns:
      - "完成(.*)需求"
      - "实现(.*)功能"
      - "交付(.*)功能"
  params:
    - name: desc
      extract: "desc"
      required: true
      description: "需求描述"
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
  examples:
    - "完成用户登录需求"
    - "实现支付功能"
    - "做一个会议预定功能"
---
# /spec-goal - 完整需求交付

## 命令说明
用户输入自然语言需求，AI 自动完成全流程：创建期次 → 创建 Task → 调度规划 → 执行 → 审查。

## 使用方式
```bash
/spec-goal 用户登录功能，支持手机号+密码登录，密码错误5次锁定
/spec-goal --desc="用户登录功能，支持手机号+密码登录"
/spec-goal --file=./docs/需求.md
/spec-goal --iteration=2026-07-会议预定
/spec-goal --skip-plan
/spec-goal --dry-run
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `<自然语言描述>` | 是* | 直接输入需求描述 | `/spec-goal 用户登录功能...` |
| `--desc=<描述>` | 是* | 需求描述 | `/spec-goal --desc="用户登录"` |
| `--file=<路径>` | 否 | 从文件读取需求 | `/spec-goal --file=./docs/需求.md` |
| `--iteration=<期次>` | 否 | 指定期次 | `/spec-goal --iteration=2026-07-会议预定` |
| `--skip-plan` | 否 | 跳过调度确认 | `/spec-goal --skip-plan` |
| `--dry-run` | 否 | 预览执行计划 | `/spec-goal --dry-run` |

> *注：`<自然语言描述>` 和 `--desc` 必须至少提供一个。

## AI 执行流程

1. 分析需求，识别任务类型（feature/bugfix/research...）
2. 创建期次（如未指定，自动生成）
3. 创建 Task 目录和文件
4. 生成调度方案
5. 执行开发（如未 `--dry-run`）
6. 审查产出（如未 `--skip-plan`）

## 输出示例
```markdown
🎯 完整需求交付完成！

📋 需求分析：
- 任务类型：feature
- 任务名称：用户登录
- 关键需求：手机号+密码登录、密码错误5次锁定

📁 已创建：
- 期次-2026-07-会议预定/
- Task-001-用户登录/

📋 调度方案：
- 后端开发：2天
- 前端开发：2天
- 可并行执行

✅ 审查结果：通过
```
