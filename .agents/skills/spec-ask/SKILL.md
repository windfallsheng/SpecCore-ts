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
2. **自动模式分两级**: 
   - **部分自动**: "analyze 和 plan 自动执行，execute 前确认" → 只跳过确认的步骤
   - **全自动**: "全自动执行/一键完成" → 所有步骤不等确认，全部自动跑
3. **迭代/任务命名必加 --topic** — 从用户原话提取英文主题词
4. **禁止 schedule** — 用户说"定时"时告知不可用、改为立即执行
5. **-i 参数用短名** — 传 `meeting-system` 而非 `Iteration-009-meeting-system`
6. **分析前先读源码** — 生成分析内容前必须 Read 相关源文件

## 执行流程

```
1. execute_command("speccore ask '用户原话'")
   → 读 KB 输出，了解可用命令

2. 检查上下文，识别自动模式:
   - "全自动/一键/全流程自动" → FULL_AUTO 全流程
   - "analyze和plan自动，execute前确认" → PARTIAL_AUTO(1-2)
   - "自动执行到split，plan和execute前确认" → PARTIAL_AUTO(1-2)
   - 没说自动 → 每步确认

3. 理解意图 → 拼计划 → 展示:
   """
   [自动模式] 将自动执行 step 1-2 (analyze+plan)，step 3 (execute) 前暂停确认。
   [全程确认] 每步展示结果再继续。
   
   step 1: speccore analyze --prompt -I meeting-system --task user-login
   step 2: speccore plan --prompt -I meeting-system --task user-login
   step 3: speccore execute --prompt -I meeting-system --task user-login
   
   是否确认？
   """

4. 用户确认后按模式执行:
   - PARTIAL_AUTO: step 1→2 连续执行，step 3 前暂停问"继续？"
   - FULL_AUTO: 全部连续执行
   - 手动: 每步暂停确认
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
