# SpecCore Execute — 代码生成执行器

> **你负责**: 读取 Task Spec → 构建代码生成上下文 → 你自己生成代码 → CLI 写入文件。
> **你不需要调用外部 AI**，你自己就是代码生成者。

## 核心规则
1. 一次只执行一个 Task。不等确认不执行下一个。
2. Task 不存在时展示可用列表让用户选。
3. 生成的代码必须匹配 CONSTITUTION 技术栈。
4. 每个文件生成完做基本语法检查（括号匹配、import 完整）。

## 执行流程

```
用户: "开发 Task-001"

1. execute_command("speccore execute --prompt -t Task-001")

   检查退出码:
   exitCode=10 → 你生成代码
   exitCode=11 → 展示 NEEDS_INFO 表格 → 用户选 Task → 重试
   其他        → [重试/跳过/停止]

2. 取 stdout [SPECCORE_PROMPT]...[/SPECCORE_PROMPT]
   解析: API 定义、数据模型、技术栈、业务规则

3. 你自己生成代码:
   格式: {"files": [{"path": "相对路径", "content": "代码"}]}
   生成 ALL API 接口 + ALL 数据模型 DDL + import 语句
   逾 60s → 分 N 批，先返回核心 API

4. 自检: files 数组非空，path 含扩展名，content > 10 字符
   失败 → 重试 ≤2 次 → 降级: 原始 text 写入 README.md

5. 写入:
   Write /tmp/speccore-exec.json
   execute_command("cat /tmp/speccore-exec.json | speccore execute --response - -t Task-001")

6. 展示: 写入文件数 + 文件清单 + 推荐下一步 (pr)
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 10 | 你生成代码 |
| 11 | 展示 Task 列表 → 用户选 |
| 其他 | [重试/跳过/停止] |

## 批量执行

```
--all 模式: 列出所有 pending Task → 用户选 → 逐个执行
每完成一个展示进度: "✅ 2/5 Task-002 完成，继续？"
```
