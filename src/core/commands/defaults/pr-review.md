# PR 审查流程

## 任务

1. 分析 git 变更，生成简洁的 commit 信息（< 72 字）
2. 对照 ANALYSIS.md 判断变更是否对齐分析范围
3. 检查代码质量和潜在风险
4. 返回 JSON 格式结果

## 变更文件

{{changedFiles}}

## 暂存文件

{{stagedFiles}}

## 变更差异

{{diff}}

## 分析文档

{{analysis}}

## 输出格式

```json
{
  "commitMsg": "提交信息（中文，<72字）",
  "analysisMatch": true|false,
  "mismatchReason": "不匹配原因（仅 analysisMatch=false 时填写）",
  "recommendation": "建议：auto-commit 或 confirm-first",
  "qualityNotes": "代码质量备注（可选）"
}
```

## 规则

- analysisMatch=true：变更内容符合分析范围，可以直接提交
- analysisMatch=false：变更超出分析范围，建议用户先确认
- 若无分析文档，analysisMatch 填 true，但 recommend 填 "confirm-first"
