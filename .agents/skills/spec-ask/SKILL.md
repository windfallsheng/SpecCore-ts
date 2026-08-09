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
   
   step 1: 🔒 AI命令: speccore analyze --prompt -I meeting-system --task user-login
   step 2: 🔒 AI命令: speccore plan --prompt -I meeting-system --task user-login
   step 3: 🔒 AI命令: speccore execute --prompt -I meeting-system --task user-login
   
   是否确认？
   """

4. 用户确认后按模式执行:
   - PARTIAL_AUTO: step 1→2 连续执行，step 3 前暂停问"继续？"
   - FULL_AUTO: 全部连续执行
   - 手动: 每步暂停确认
```

## 关键命令

| 命令 | 格式 | 类型 | 说明 |
|:---|:---|:---|:---|
| `analyze --prompt -I <短名> --task <短名>` | 分析任务 | 🔒 AI | 需要宿主 AI 交互，`speccore ask "分析..."` 路由进入 |
| `plan --prompt -I <短名> --task <短名>` | 制定计划 | 🔒 AI | 需要宿主 AI 交互，`speccore ask "制定计划..."` 路由进入 |
| `execute --prompt -I <短名> --task <短名>` | 执行开发 | 🔒 AI | 需要宿主 AI 交互，`speccore ask "执行开发..."` 路由进入 |
| `iteration split -I <短名>` | 拆分任务 | 🔒 AI | 需要宿主 AI 交互，`speccore ask "拆分任务..."` 路由进入 |
| `context --set --iteration <完整名>` | 切换迭代 | CLI | 可在终端直接输入 |
| `dashboard` | 查看进度 | CLI | 可在终端直接输入 |
| `task new -n <名> --topic <英文> -i <短名>` | 创建任务 | CLI | 可在终端直接输入 |

## AI 分析质量要求

执行 analyze --prompt（🔒 AI命令）后:
1. **Read 迭代目录下所有源码文件**（REQUIREMENT.md、010-requirements/sources/ 下的文档）
2. **分析报告必须包含 7 个文档**（不同任务类型不同集合）:

### 全量分析（feature 类型）
| 文档 | 内容要求 |
|:---|:---|
| **ANALYSIS.md** | 功能点列表、接口清单、数据模型、业务规则、异常处理 |
| **TECH.md** | 架构方案、数据库 DDL、缓存策略、核心流程图 |
| **TEST.md** | 单元测试用例、集成测试方案、边界条件 |
| **REVIEW.md** | 代码审查检查项、安全审查清单 |
| **RISK.md** | 风险矩阵、缓解措施、回滚方案 |
| **DEPS.md** | 上下游依赖、SLA 要求 |
| **MONITOR.md** | 业务监控指标、告警规则 |

### 精简分析（bugfix/research 类型）
| 文档 | 内容 |
|:---|:---|
| ANALYSIS.md | 问题定位 + 修复方案 |
| TEST.md | 回归测试用例 |

3. **写入格式**: `--apply '{"ANALYSIS.md":"...","TECH.md":"..."}'` JSON 多文档写入
4. **不要生成空洞模板** — 每个字段都要有具体内容（表名、字段名、接口路径、阈值数值）

## 禁止行为

- ❌ 用户没说自动就全自动跑
- ❌ schedule 命令（任何形式）
- ❌ 传完整迭代名到 -i 参数
- ❌ 分析时不读源码凭空生成
- ❌ 不展示计划直接执行
