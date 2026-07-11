---
name: spec-review
aliases: [spec-rv, spec-chk]
suggestions:
  - "--task=<Task编号>   审查指定 Task"
  - "--iteration=<期次>  审查整个期次"
  - "--type=<类型>       按类型批量审查"
  - "--skip-validate     跳过合规检查"
description: ✅ 审查 Task 的产出物和验收标准
category: SpecCore
intent:
  triggers:
    keywords: [审查, 检查, review, 查看, 核对, 校验]
    patterns:
      - "审查(.*)"
      - "检查(.*)"
      - "查看(.*)"
      - "review(.*)"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "任务编号（auto=当前任务）"
  examples:
    - "审查 Task-001"
    - "检查一下代码"
    - "review 一下会议室管理"
---
# /spec-review - 审查产出

## 命令说明
对指定 Task 的产出物进行全面审查，检查是否满足所有验收标准。

## 使用方式
```bash
/spec-review Task-001
/spec-review --iteration=2026-07-会议预定
/spec-review --type=feature
/spec-review Task-001 --skip-validate
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--task=<Task编号>` | 是* | 目标任务 | `/spec-review Task-001` |
| `--iteration=<期次>` | 是* | 审查整个期次 | `/spec-review --iteration=2026-07-会议预定` |
| `--type=<任务类型>` | 否 | 按类型批量审查 | `/spec-review --type=feature` |
| `--skip-validate` | 否 | 跳过合规性检查 | `/spec-review Task-001 --skip-validate` |

> *注：`--task` 和 `--iteration` 必须二选一。

## AI 执行流程

1. 加载所有相关文件（REQ.md、TECH.md、TASK.md、API_CONTRACT.yaml）
2. 检查产出物清单是否完整
3. 验证验收标准（AC）是否通过
4. 验证技术方案符合性
5. 验证代码中是否包含 `@spec` 注释
6. 生成审查报告

## 输出示例
```markdown
📊 审查报告
Task: Task-001-用户登录

审查结果: ⚠️ 有条件通过

🔍 技术方案符合性
- 核心类设计符合 TECH.md
- 代码包含 @spec 注释
- 异常处理覆盖全部场景（缺失 Redis 超时处理）

✅ 验收标准
- AC-01: 接口响应时间 < 200ms
- AC-02: 单元测试覆盖率 ≥ 90%（当前 72%）

📋 建议
1. 补充单元测试提升覆盖率
2. 增加 Redis 超时异常处理
```
