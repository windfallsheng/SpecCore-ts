# SpecCore Iteration Create — 交互式迭代创建（高阶 Skill）

> **你负责**: 接收描述 → 智能命名 → 检查平台映射 → 创建迭代 → 推荐下一步。

## 命名规则

1. 从用户描述中提取核心关键词，转为英文驼峰/短横线格式作为名称后缀。
2. 用户明确提供的编号/日期/人名保留原样并拼入名称。
3. 格式: `Iteration-{序号}-{英文关键词}` 或 `Iteration-{序号}-{用户提供的信息}`

```
用户说: "创建Q2迭代"      → Iteration-002-Q2
用户说: "商城重构"          → Iteration-003-mall-refactor
用户说: "260806 zhangsan"  → Iteration-004-260806-zhangsan
用户说: "双11大促活动"     → Iteration-005-double11-campaign
用户说: "安全漏洞修复Sprint3" → Iteration-006-security-sprint3
```

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
