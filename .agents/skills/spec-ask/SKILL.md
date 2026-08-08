---
name: spec-ask
description: >
  SpecCore 可执行编排引擎。处理意图识别 → CLI 执行 → AI 内容生成 → 写入。
  Use when user says anything that doesn't match a specific skill route,
  or complex multi-step requests involving "然后" "接着" "定时" "分批" "调度".
  Always invoked via execute_command("speccore ask '...'").
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---
## 🚫 禁止

- 禁止跳过 ask 引擎直接自行猜测意图
- 禁止在 pipeline 未完成时跳到下一步
- 禁止无用户确认时执行破坏性操作
- 禁止输出 speccore 命令给用户

# SpecCore Ask — 可执行编排引擎 v4

> **你的身份**: 你就是宿主 AI。你的任务是：理解用户意图 → 调用 CLI --prompt → 自己生成内容 → 调 CLI --response 写入。  
> 你不是在"描述"流程，你就是在**执行**流程。不要调用外部 AI，你自己就是那个"AI 生成"环节的负责者。
> **每次用户调用 /spec-ask 都必须执行 speccore ask，不可以跳过、缓存或说"已执行过"。**

---

## 核心规则

1. 一次一个命令。不等用户确认不执行下一个。
2. 每次执行完检查退出码，按速查表行事。
3. 参数缺了让用户选，不猜。
4. 你自己生成的内容必须校验格式。失败重试 ≤ 2 次。
5. Pipeline 每步完成等用户确认。
6. 执行完成展示摘要 + 推荐下一步。

---

## 步骤 0: 判断输入类型

```
判断标准（按顺序检查）:

  IF 含 "?"/"吗"/"怎么"/"是什么"/"如何" AND 不是明确动作词（分析/执行/拆分/开发/导入）
     → 分支 C (explain)
  ELSE IF 含 "然后"/"再"/"接着"/"最后"/"全流程"/"从头"
     → 分支 D (pipeline)  
  ELSE IF 有意向性的动词（"帮我"/"做"/"跑"/"执行"）
     → 步骤 1 (意图识别)
  ELSE
     → 分支 C (explain) — 默认解释/查询
```

---

## 步骤 1: 意图识别

```
执行: speccore ask "{用户输入}"

⚠️ 先处理 HTML 标记（优先于 SPECCORE_MODE）:
  [SPECCORE_ONBOARD:<path>] → present_files 展示引导页
  [SPECCORE_ABOUT:<path>]    → present_files 展示版本信息
  同时输出 📄 file://... 让用户点击

然后从 stdout 提取 [SPECCORE_MODE: xxx] → 进对应分支
若无标记 → 用步骤 0 标准判断
```

---

## 分支 A: match — 单命令

```
A-FAIL: 低置信 → 请用户重新描述

A1. 补参:
    Read .speccore/local/context.json → 获取 currentIteration/currentTask
    仍缺 → execute_command("speccore {cmd} --prompt {有参}")
      exitCode=11 → 读 NEEDS_INFO 表格 → 用户选 → 重试

A2. 确认（最多 3 轮追问）:
    "📋 执行: speccore {cmd} --prompt {params} [是/改/停]"

A3. 执行:
    execute_command("speccore {cmd} --prompt {params}")
    exitCode=0  → 步骤 4
    exitCode=10 → A4
    exitCode=11 → A1
    其他        → [重试/跳过/停止]

A4. 你生成 (60s):
    取 stdout [SPECCORE_PROMPT]...[/SPECCORE_PROMPT]
    你是 AI — 你自己生成代码/分析/文档

A5. 自检:
    execute: {"files":[...]}, 其他: Markdown >100 字符
    失败 → 重试 ≤2 次 → 降级

A6. 写入:
    Write /tmp/speccore-resp.json
    execute_command("cat /tmp/speccore-resp.json | speccore {cmd} --response - {params}")
    注意: --response - 表示从 stdin 读取，已验证可用
```

---

## 分支 B: ambiguous

```
展示候选人 → 用户选 → 分支 A
```

---

## 分支 C: explain

```
直接回答。不调 CLI。
```

---

## 分支 D: pipeline (≤5 步)

```
D1. 展示计划，等确认
D2. 逐步执行（每步走 A3-A6）
D3. 步间: Read 产出文件 → 提取参数 → 传下一步
```

---

## 分支 E: guide

```
展示流程 → 用户选[开始]进 D 或 [仅查看]结束
```

---

## 步骤 4: 总结

**🔴 必须输出 HTML 文件链接：** 用 `ls speccore-*.html` 扫描项目根目录所有 HTML 文件，向用户逐个列出 `file://` 完整路径。
```
展示: 文件列表 + 警告 + 下一步推荐
询问继续
```

---

## 退出码

| exitCode | 行动                |
| :------- | :---------------- |
| 0        | 展示结果              |
| 10       | 你自己生成内容 → --apply |
| 11       | 展示参数表 → 用户补       |
| 其他       | [重试/跳过/停止]        |

---

## 完整命令

| 场景   | --prompt                          | --apply/response |
| :--- | :-------------------------------- | :--------------- |
| 导入文档 | `doc2spec --prompt -f {f}`        | `--response`     |
| 分析   | `analyze --prompt -I {i}`         | `--apply`        |
| 拆分   | `iteration split --prompt -I {i}` | `--response`     |
| 计划   | `plan --prompt -I {i}`            | `--response`     |
| 开发   | `execute --prompt -t {t}`         | `--response`     |
| PR   | `pr --prompt -t {t}`              | `--response`     |
| 归档   | `done --prompt -t {t}`            | `--response`     |
| 导出   | `spec2doc --prompt -I {i}`        | `--apply`        |
| 仪表盘  | `dashboard`                       | —                |
| 验证   | `validate -I {i}`                 | —                |
| 回顾   | `retro --task {t}`                | —                |
| 搜索   | `search {k}`                      | —                |
| 初始化  | `init`                            | —                |
