---
name: spec-execute
description: SpecCore Execute
---
## ⛔ 核心铁律
有任务就执行，禁止说"已完成"而跳过。支持 --force 重跑。

## 执行
1. Read Task REQ.md and TECH.md for completeness
2. Check .needs-retry for previous failures
3. Show execution plan and batch info
4. Execute: speccore execute -i ${1:Q1} -t ${2:Task-001} --type ${3|feature,bugfix,research|} --force
5. If failed, write .issues.md and suggest --resume

## v7.2.0+ 典型 execute 场景

### 场景 1: 全量自动执行

**AI 说法：**
> "执行所有任务" / "自动开发全部" / "跑 execute" / "开始写代码"

**触发命令：**
```bash
speccore execute -i Q2 --auto
```
适用: 按计划顺序自动执行所有待开发任务，适合信任 AI 全自动

---

### 场景 2: 指定任务执行

**AI 说法：**
> "执行 Task-001" / "只开发登录模块" / "先做这个任务"

**触发命令：**
```bash
speccore execute -i Q2 -t Task-001
speccore execute -i Q2 -t Task-001,Task-002
```
适用: 只执行特定任务，不碰其他任务

---

### 场景 3: 分批执行（推荐大迭代）

**AI 说法：**
> "分批执行，每批 3 个" / "任务太多分批来" / "一批一批开发"

**触发命令：**
```bash
speccore execute -i Q2 --batch-size 3 --auto
```
适用: 任务多时分批执行，每批 3 个任务，降低风险

---

### 场景 4: 断点续传

**AI 说法：**
> "继续上次执行" / "resume" / "断点续传" / "上次失败的任务继续"

**触发命令：**
```bash
speccore execute -i Q2 --resume
```
适用: 上次执行中途失败，从 .needs-retry 标记处继续

---

### 场景 5: 强制重跑

**AI 说法：**
> "强制重跑 Task-001" / "重新执行这个任务" / "覆盖之前的"

**触发命令：**
```bash
speccore execute -i Q2 -t Task-001 --force
```
适用: 任务之前已完成但需要重新执行（如代码标准变更）

---

### 场景 6: 只执行特定类型

**AI 说法：**
> "先执行 bugfix" / "只做 feature 类型" / "优先处理 bug"

**触发命令：**
```bash
speccore execute -i Q2 --type bugfix --auto
speccore execute -i Q2 --type feature --batch-size 2
```
适用: 迭代中 bugfix 和 feature 混杂，先集中处理 bugfix

---

### 场景 7: 获取待执行清单（不执行）

**AI 说法：**
> "看看有哪些任务待执行" / "列出待开发清单" / "pending 任务有哪些"

**触发命令：**
```bash
speccore execute -i Q2 --list-pending
```
适用: 执行前先看有哪些任务待执行，确认后再分批跑

---

### 场景 8: 结合深度分析的上下文执行

**AI 说法：**
> "先确保 spec 质量再开发" / "基于深度分析结果执行" / "高质量 spec 后写代码"

**触发命令：**
```bash
# 先确保分析产物已深度生成
speccore analyze -i Q2 --deep TECH.md --with-code
# 再基于高质量 spec 执行
speccore execute -i Q2 --auto
```
适用: 对核心任务先确保 spec 质量，再进入开发执行
