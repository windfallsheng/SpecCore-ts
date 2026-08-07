---
name: spec-iteration-create
description: >
  迭代创建。AI 英文关键词命名 + 平台检查。
  Use when user says "创建迭代" "新建迭代" "Sprint".
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---
# SpecCore Iteration Create — 交互式迭代创建（高阶 Skill）

> **你负责**: 接收描述 → 智能命名 → 检查平台映射 → 创建迭代 → 推荐下一步。

## 命名规则（由你——AI——生成英文关键词）

```
你根据用户描述，自己提取核心概念并翻译为简洁英文（≤4 个单词）:
1. 提取用户明确给出的编号/日期/人名 → 必须保留
2. 中文描述 → 你翻译为英文关键词
3. 组合: Iteration-{序号}-{保留的ID}-{你生成的英文关键词}

示例:
用户: "商城重构"          → 你: Iteration-003-mall-refactor
用户: "260806 zhangsan负责" → 你: Iteration-004-260806-zhangsan
用户: "双11大促活动"       → 你: Iteration-005-double11-campaign
用户: "Q3安全漏洞修复"     → 你: Iteration-006-Q3-security-fix
```

1. 确认时显示你生成的名字 → 用户可以修改
2. 不改直接给你 → 你就是用这个名字创建

## 执行流程

```
1. 解析用户输入:
   - 检测编号/日期/人名模式: /\d{4,}|[A-Z]+\d+|(?<=\s)[a-z]+$/i
   - 保留原文作为名称的一部分
   - 其他中文描述 → 提取核心词 → 翻译为英文关键词

2. 确认:
   "📋 将创建迭代:
    - 名称: Iteration-{num}-{keywords}
    - 描述: {从用户输入总结}
    - 平台映射: {从CONSTITUTION读取}
    是否正确？"

3. 创建:
   execute_command("speccore iteration create -n {keywords}")

4. 推荐:
   speccore doc2spec --prompt -f PRD.docx --iter {keywords}
   speccore ask "帮我导入需求文档到 {keywords}"
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 0 | 创建完成 → 推荐下一步 |
| 其他 | [重试/跳过] |
