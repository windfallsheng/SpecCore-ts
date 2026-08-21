---
name: spec-analyze
description: SpecCore Analysis
---
## ⛔ 核心铁律
分析必须落盘到 020-specs/，禁止只输出聊天文字。走 speccore analyze --prompt → Read 文档 → --apply 流程。

## 执行
1. Read 010-requirements/ for all platform docs
2. Ask user for iteration name if not provided
3. Execute: speccore analyze -I ${1:Q1} --task ${2:Task-001}
4. Present analysis report and ask for confirmation

## v7.2.0+ 分析场景速查

### 场景 1: 迭代级标准分析（默认）
```bash
speccore analyze -I Q2
```
适用: 常规迭代需求分析，生成 REQUIREMENT.md / ANALYSIS.md / TECH.md / TEST.md / SCHEMA.md

### 场景 2: 全局级架构分析
```bash
speccore analyze --scope global
speccore analyze --scope global --with-code
```
适用: 新项目初始化、跨端架构梳理、技术栈盘点

### 场景 3: 单文档深度分析（--deep）
```bash
speccore analyze --scope global --deep ARCHITECTURE.md
speccore analyze --scope global --deep TECH.md --iterative
```
适用: 某份文档需要高质量产出（字数翻倍、图表翻倍、结构化数据全量注入）

### 场景 4: 迭代式生成（--iterative）
```bash
speccore analyze -I Q2 --iterative
speccore analyze --scope global --deep DATA_FLOW.md --iterative
```
适用: 复杂文档怕 AI 生成空洞内容，先出大纲确认后再逐节填充

### 场景 5: 按需分析指定模块（--filter）
```bash
speccore analyze --scope global --filter "订单,支付,购物车"
speccore analyze -I Q2 --filter "用户认证" --with-code
```
适用: 大项目只关心部分功能，减少 Token 消耗和无关输出

### 场景 6: 代码关联分析（--with-code）
```bash
speccore analyze -I Q2 --with-code
speccore analyze --scope global --with-code --filter "订单模块"
```
适用: 已有代码基础，需要 AI 结合源码做精准分析（自动注入 API/Entity/Route/Component）

### 场景 7: 细粒度功能单元分析
```bash
# 自然语言触发: "分析 TECH.md 中的订单模块"
speccore analyze -I Q2 --doc TECH.md --feature "订单模块"
```
适用: 只分析某文档中的某个功能单元，AI 自动关联代码和需求上下文

### 场景 8: 重新/补充分析（--supplement / --sync）
```bash
speccore analyze -I Q2 --supplement
speccore analyze -I Q2 --supplement --source-scope src/core
speccore analyze --task Task-001 --sync
```
适用: 代码变更后补充分析、遗漏模块追加、任务级分析后回写 020-specs/

### 场景 9: 任务级分析
```bash
speccore analyze --task Task-001
speccore analyze --task Task-001 --apply "修正边界条件描述"
```
适用: 对单个任务做深入分析，或根据反馈修正已有分析

## 参数组合建议

| 目标 | 推荐组合 |
|------|----------|
| 新项目全局架构 | `--scope global --with-code --iterative` |
| 迭代需求常规分析 | `-I Q2` |
| 出一份精品架构文档 | `--scope global --deep ARCHITECTURE.md --iterative --with-code` |
| 只关心订单相关 | `--scope global --filter "订单" --with-code` |
| 代码变了补充分析 | `-I Q2 --supplement --with-code` |
| 分析订单模块实现 | `-I Q2 --doc TECH.md --feature "订单" --with-code` |
