---
name: spec-validate
aliases: [spec-vl, spec-val]
suggestions:
  - "--iteration=<期次>  检查指定迭代"
  - "--task=<Task编号>   检查指定 Task"
  - "--type=<类型>       按任务类型检查"
  - "--fix               尝试自动修复"
  - "--strict            严格模式"
  - "--format=json       输出 JSON 格式"
description: 🔍 Spec 合规性检查：扫描所有 Spec 文件，验证是否符合框架规范
category: SpecCore
intent:
  triggers:
    keywords: [合规, 校验, 检查规范, 格式检查]
    patterns:
      - "合规检查"
      - "校验(.*)"
      - "检查规范"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
    - name: fix
      extract: "fix"
      default: false
      description: "是否自动修复"
  examples:
    - "跑一下合规性检查"
    - "检查规范"
    - "修正合规性问题"
---
# /spec-validate - Spec 合规性检查

## 命令说明
扫描所有 Spec 文件，检查是否符合框架规范。

## 使用方式
```bash
/spec-validate
/spec-validate --iteration=2026-07-会议预定
/spec-validate --task=Task-001
/spec-validate --type=feature
/spec-validate --fix
/spec-validate --strict
/spec-validate --format=json
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 检查全部 | `/spec-validate` |
| `--iteration=<期次>` | 否 | 检查指定期次 | `/spec-validate --iteration=2026-07-会议预定` |
| `--task=<Task编号>` | 否 | 检查指定任务 | `/spec-validate --task=Task-001` |
| `--type=<任务类型>` | 否 | 按任务类型检查 | `/spec-validate --type=feature` |
| `--fix` | 否 | 尝试自动修复 | `/spec-validate --fix` |
| `--strict` | 否 | 严格模式 | `/spec-validate --strict` |
| `--format=json` | 否 | 输出 JSON 格式 | `/spec-validate --format=json` |

## 检查项

| 检查项 | 严重级别 | 说明 |
| :--- | :--- | :--- |
| 目录结构完整 | ❌ 错误 | 必需目录是否存在 |
| REQ.md 必需章节 | ❌ 错误 | 是否有"需求描述"、"验收标准" |
| TASK.md 必需章节 | ❌ 错误 | 是否有"变更履历"、"产出物清单" |
| API_CONTRACT.yaml | ❌ 错误 | 是否为有效 YAML |
| TECH.md 必需章节 | ⚠️ 警告 | 是否有"方案概述"、"核心设计" |
| 追溯链完整 | ⚠️ 警告 | 是否追溯到上层文档 |
| 任务类型文件 | ⚠️ 警告 | `.task-type` 是否存在且有效 |
| @spec 注释 | ⚠️ 警告 | 代码文件是否包含 @spec 注释 |

## 输出示例
```markdown
📋 Spec 合规性报告

❌ 错误（必须修复）

| 文件 | 问题 | 建议 |
| :--- | :--- | :--- |
| Task-001/backend/TASK.md | 缺少"变更履历"表格 | 在文件头部添加变更履历 |

⚠️ 警告（建议修复）

| 文件 | 问题 | 建议 |
| :--- | :--- | :--- |
| Task-002/backend/REQ.md | 缺少"验收标准"章节 | 添加验收标准列表 |
| Task-001/backend/REQ.md | 缺少 @spec 追溯链 | 添加追溯链引用 |

统计摘要
- 检查文件数：24
- ❌ 错误：1 个
- ⚠️ 警告：2 个
- ✅ 通过率：88%
```
