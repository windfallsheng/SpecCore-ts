# SpecCore Ask — 意图识别 + Prompt/Apply 编排器

> **角色**: 用户自然语言 → 意图识别 → 拼出 --prompt 命令 → 捕获 Prompt → AI 处理 → 写入结果

---

## 四大模式（已接入 Prompt/Apply）

### 模式1: 命令解释
用户问某个命令用法时，返回帮助文本（无需 Prompt/Apply）。

### 模式2: 意图匹配 → Prompt/Apply
```
用户: "分析 Q1 的需求"
  → Skill 识别意图: analyze
  → 拼命令: speccore analyze --prompt -I Q1
  → execute_command 执行 → 获取 [SPECCORE_PROMPT]
  → 提交给宿主 AI 分析
  → AI 返回分析结果
  → execute_command("speccore analyze --apply '$result' -I Q1")
  → ✅ ANALYSIS.md 已写入
```

### 模式3: 任务指引 → 多步 Prompt/Apply
```
用户: "帮我做登录功能"
  → 计划: doc2spec --prompt → analyze --prompt → split --prompt → execute --prompt
  → 每一步都是: CLI --prompt → 捕获 → AI 处理 → CLI --apply/--response
```

### 模式4: 复杂编排 → 全 Pipeline
```
用户: "从需求到代码全流程"
  → 串联: doc2spec → analyze → split → plan → execute → pr → done
  → 每步都走 --prompt/--apply 循环
```

---

## 意图 → --prompt 命令映射

| 用户意图 | --prompt 命令 | --apply/--response 命令 |
| :--- | :--- | :--- |
| 导入需求 | `speccore doc2spec --prompt -f {file}` | `speccore doc2spec --response '...' -f {file}` |
| 分析需求 | `speccore analyze --prompt -I {iter}` | `speccore analyze --apply '...' -I {iter}` |
| 拆分任务 | `speccore iteration split --prompt -I {iter}` | `speccore iteration split --response '...' -I {iter}` |
| 执行开发 | `speccore execute --prompt -t {task}` | `speccore execute --response '...' -t {task}` |
| 生成计划 | `speccore plan --prompt -I {iter}` | `speccore plan --response '...' -I {iter}` |
| 导出文档 | `speccore spec2doc --prompt -I {iter}` | `speccore spec2doc --apply '...' -o {file}` |
| 创建PR | `speccore pr --prompt -t {task}` | `speccore pr --response '...' -t {task}` |
| 归档验收 | `speccore done --prompt -t {task}` | `speccore done --response '...' -t {task}` |
