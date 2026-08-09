---
name: spec-ask
description: >
  SpecCore 意图引擎 — 宿主 AI 语义分析入口。
  所有用户操作走此 Skill。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

# SpecCore Ask — AI 语义分析引擎

## 🚨 核心铁律

1. **每步必确认** — 用户没明确说"自动/全自动/一键"的，每步展示计划→等确认→再执行
2. **迭代/任务命名必加 --topic** — 从用户原话提取英文主题词，不要传中文或空
3. **禁止 schedule** — schedule 命令已废弃，用户说"定时"时直接告知不可用、改为立即执行
4. **-i 参数用短名** — 传 `meeting-system` 而非 `Iteration-009-meeting-system`
5. **分析前先读源码** — 生成分析内容前必须 Read 相关源文件，不要凭空写

## 执行流程

```
1. execute_command("speccore ask '用户原话'")
   → 读 KB 输出，了解可用命令

2. 检查上下文（context.json），确认当前迭代

3. 理解意图 → 拼计划 → 展示给用户:
   """
   我理解你要:
   1. 分析 Q1 的任务 user-login（将读取源码后生成分析报告）
   2. 为任务 user-login 制定开发计划
   
   是否确认？
   """

4. 用户确认后逐步执行，每步检查结果
```

## 关键命令

| 命令 | 格式 | 需要 AI |
|:---|:---|:---:|
| `analyze --prompt -I <短名> --task <短名>` | 分析任务 | ✅ |
| `plan --prompt -I <短名> --task <短名>` | 制定计划 | ✅ |
| `execute --prompt -I <短名> --task <短名>` | 执行开发 | ✅ |
| `context --set --iteration <完整名>` | 切换迭代 | ❌ |
| `dashboard` | 查看进度 | ❌ |
| `iteration split -i <短名>` | 拆分任务 | ✅ |
| `task new -n <名> --topic <英文> -i <短名>` | 创建任务 | ❌ |

## AI 分析质量要求

执行 analyze --prompt 后:
1. **Read 迭代目录下所有源码文件**（REQUIREMENT.md、010-requirements/sources/ 下的文档）
2. **生成分析必须包含**: 功能点列表、接口清单、数据模型、业务规则、异常处理
3. **不要生成空洞模板** — 每个字段都要有具体内容
4. 分析写入 `020-specs/ANALYSIS.md`

## 禁止行为

- ❌ 用户没说自动就全自动跑
- ❌ schedule 命令（任何形式）
- ❌ 传完整迭代名到 -i 参数
- ❌ 分析时不读源码凭空生成
- ❌ 不展示计划直接执行
