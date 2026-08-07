# Plan Template — 迭代级执行计划

## 使用方式
speccore plan 生成 `Iteration-{name}/000-overview/PLAN-{ts}-{slug}.md`
PLAN.md 始终为最新版本。

## 计划文件标准结构（8 章）

```markdown
# 📋 Plan — {iteration}
> 生成时间 | 状态 | 任务数 | 阶段数 | 预估

## 1. Mermaid 依赖关系图
## 2. Mermaid 执行甘特图
## 3. 执行概览（表格）
## 4. 任务详情
## 5. 风险评估（高依赖/高优先级自动标红）
## 6. 里程碑（Phase 验收标准）
## 7. 回滚方案
## 8. 执行记录（追加式）
```

## 计划文件位置

所有计划统一存放：`Iteration-{name}/000-overview/`
- `PLAN-{ts}-{slug}.md` — 多版本历史（按时间倒序）
- `PLAN.md` — 始终为最新版本

单个任务执行不需要计划（快速开发），多任务/迭代级执行才生成计划。
