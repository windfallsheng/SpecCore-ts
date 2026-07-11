---
name: spec-retro
aliases: [spec-rt]
description: 📊 期次回顾：自动生成期次回顾报告
category: SpecCore
intent:
  triggers:
    keywords: [回顾, 总结, 复盘, 反思]
    patterns:
      - "回顾(.*)"
      - "总结(.*)"
      - "复盘(.*)"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
  examples:
    - "回顾一下这个期次"
    - "总结一下"
    - "复盘会议预定项目"
---
# /spec-retro - 期次回顾

## 命令说明
对指定或当前期次进行回顾，自动生成：完成率分析、延期原因分析、模式沉淀总结、下期改进建议。

## 使用方式
```bash
/spec-retro
/spec-retro --iteration=2026-07-会议预定
/spec-retro --format=json
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 使用当前期次 | `/spec-retro` |
| `--iteration=<期次>` | 否 | 指定期次 | `/spec-retro --iteration=2026-07-会议预定` |
| `--format=<格式>` | 否 | 输出格式（markdown/json） | `/spec-retro --format=json` |

## AI 执行流程

1. 读取期次所有 Task 的状态
2. 分析完成率、延期率
3. 分析延期原因（需求变更、技术难点、资源不足等）
4. 总结沉淀的模式和踩坑记录
5. 生成下期改进建议

## 输出示例
```markdown
📊 期次回顾报告 - 2026-07-会议预定

📈 完成率分析
- 总 Task 数：5
- 已完成：4（80%）
- 延期：1（20%）
- 平均延期天数：2天

🔍 延期原因分析
- Task-003 延期：需求变更（登录增加验证码）
- 根因：需求变更未及时同步到 Spec

💡 模式沉淀
- 用户登录模块的验证码方案可复用
- 已沉淀到 PATTERNS/代码复用模式

🚀 下期改进建议
1. 加强需求变更联动（/spec-change）
2. 提前识别技术风险（在 TECH.md 中增加风险章节）
3. 增加每日 /spec-progress 检查
```
