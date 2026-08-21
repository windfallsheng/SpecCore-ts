---
name: spec-split
description: SpecCore Task Split
---
## ⛔ 核心铁律
分析完成后必须拆分，禁止跳过。有确认理由可确认后再执行。

## 执行
1. Read 020-specs/ for analysis docs
2. Read STAFFING.md for team allocation
3. Dry-run split and show preview
4. Ask user to confirm before creating tasks
5. Execute: speccore iteration split -i ${1:Q1} --owner ${2|张三,李四,王五|}

## v7.2.0+ 典型 split 场景

### 场景 1: 标准拆分（基于分析产物）
```bash
speccore split -i Q2
```
适用: analyze 完成后，按 020-specs/ 的分析结果自动拆分为 Task 目录

### 场景 2: 基于指定文档拆分
```bash
speccore split -f 020-specs/global/REQUIREMENT.md
speccore split -f 020-specs/backend/TECH.md
```
适用: 只想基于某份特定文档拆分，而非全部分析产物

### 场景 3: 按功能模块拆分
```bash
speccore split -i Q2 --feature "用户认证"
speccore split -i Q2 --feature "订单管理"
```
适用: 大迭代中只拆分某个功能模块的任务

### 场景 4: 追加拆分（已有任务后新增）
```bash
speccore split -i Q2 --append
```
适用: 迭代已有一部分任务，分析补充后追加新任务而不覆盖旧任务

### 场景 5: 全局层拆分（跨端）
```bash
speccore split --scope global
```
适用: 基于全局分析产物，按端拆分为多个迭代的任务

### 场景 6: 拆分时指定人员
```bash
speccore split -i Q2 --owner 张三 --backend-owner 李四 --frontend-owner 王五
```
适用: 明确各端负责人，拆分后自动写入 STAFFING.md
