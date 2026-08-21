---
name: spec-dev
description: SpecCore Smart Pipeline
---
## ⛔ 核心铁律
走完整 analyze→split→plan→execute 链路，禁止跳过任何步骤。

## 执行
1. Read .speccore/local/context.json for current state
2. Read 000-overview/PROJECT_GRAPH.md for progress
3. Present current phase and recommend next step
4. Execute: speccore dev -i ${1:Q1} ${2|,--auto|}

## v7.2.0+ 典型 dev 场景

### 场景 1: 全自动流水线（推荐）

**AI 说法：**
> "全自动完成登录功能" / "全流程自主开发" / "analyze 到 done 全自动"

**触发命令：**
```bash
speccore dev -i Q2 --auto
```
适用: 信任 AI 全自动完成 analyze→split→plan→execute→pr→done，全程无需确认

---

### 场景 2: 半自动（关键步骤确认）

**AI 说法：**
> "开发登录功能，关键步骤确认" / "跑 dev，plan 之前停一下" / "半自动模式"

**触发命令：**
```bash
speccore dev -i Q2
```
适用: analyze/split/plan 后暂停确认，execute 阶段再自动推进

---

### 场景 3: 从指定阶段继续

**AI 说法：**
> "分析已完成，从拆分开始" / "plan 好了，直接执行" / "从执行阶段继续"

**触发命令：**
```bash
# 分析已完成，从拆分开始
speccore dev -i Q2 --from split
# 计划已完成，从执行开始
speccore dev -i Q2 --from execute
```
适用: 之前完成了部分步骤，不想重复跑

---

### 场景 4: 全局级 dev（新项目）

**AI 说法：**
> "新项目从零开始" / "全局分析后进入迭代开发" / "先做架构再开发"

**触发命令：**
```bash
speccore dev --scope global --auto
```
适用: 新项目从零开始，先做全局分析再进入迭代开发

---

### 场景 5: 断点续传

**AI 说法：**
> "上次中断了，继续" / "断点续传" / "resume 上次开发"

**触发命令：**
```bash
speccore dev -i Q2 --resume
```
适用: 上次执行到一半中断了，从 .needs-retry 继续

---

### 场景 6: 深度分析后开发

**AI 说法：**
> "先深度分析订单模块再开发" / "确保 spec 质量后再写代码" / "深度分析后自动开发"

**触发命令：**
```bash
# 先深度分析订单模块，再自动开发
speccore analyze --scope global --deep --filter "订单" --with-code
speccore dev -i Q2 --from split --auto
```
适用: 对核心模块先做深度分析，确保 spec 质量后再开发
