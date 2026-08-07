# SpecCore Iteration Create — 交互式迭代创建（高阶 Skill）

> **你负责**: 接收描述 → 命名与编码确认 → 检查平台映射 → 创建迭代 → 推荐下一步。

## 核心规则

1. 迭代名称自动规范化：用户提供名称 → 生成 `Iteration-NNN-名称`。
2. 检查 CONSTITUTION 平台映射，确保需求端已配置。
3. 创建后推荐 doc2spec 或 analyze。

## 执行流程

```
1. 接收描述:
   用户: "创建Q2迭代"
   用户: "给我创建一个新迭代用于商城重构"

2. 解析确认:
   "📋 将创建迭代:
    - 编号: Iteration-{next_number}
    - 名称: {normalized_name}
    - 需求端: {platforms from CONSTITUTION}
    是否确认？[是/修改名称/修改平台]"

3. 创建:
   execute_command("speccore iteration create -n {name}")

4. 推荐:
   speccore doc2spec -f PRD.docx --iter {name}
   speccore analyze --prompt -I {name}
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 0 | 创建完成 → 推荐下一步 |
| 11 | 参数不足 → 追问 |
| 其他 | [重试/跳过] |
