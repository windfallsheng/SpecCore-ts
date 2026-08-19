---
name: spec-split
description: >
  任务拆分专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（analyze 是否完成、端列表提取、变更检测），
  参数缺失时输出交互式提示（参数说明 + 使用示例）。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-split — 任务拆分（专属逻辑）

> **定位**：`/split` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力，只在调用 ask 之前做参数校验和上下文准备

---

## 调用方式

```
/split [参数]
/split -I Iteration-001 --platforms api,h5
/split --modules "购物车,订单" --prune
```

---

## 执行流程

```
用户输入 /split [参数]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 参数提取                        │
│ 从用户输入提取 iteration/platforms/modules 等 │
└───────────────┬───────────────────────┘
                │
        参数缺失？
                │
        是 ──► 输出交互式提示（参数说明 + 示例）
                │ 让用户补充后重新调用
                │
        否 ──► 继续
                │
                ▼
┌───────────────────────────────────────┐
│ Step 2: 参数补全                        │
│ iteration 缺失 → 读 context.json        │
│ platforms 缺失 → 从 CONSTITUTION 检测   │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 3: 前置校验                        │
│ - analyze 是否完成？                    │
│ - 020-specs/ 是否有更新？               │
│ - 已有 Task 结构扫描                    │
└───────────────┬───────────────────────┘
                │
        校验失败？
                │
        是 ──► 输出问题 + 修复建议
                │
        否 ──► 继续
                │
                ▼
┌───────────────────────────────────────┐
│ Step 4: 生成专属 Prompt                 │
│ 根据校验结果生成上下文丰富的 Prompt       │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 5: 调用 speccore ask               │
│ execute_command("speccore ask '...'")   │
└───────────────────────────────────────┘
```

---

## Step 1: 参数提取

从用户输入提取以下参数：

| 参数 | 短名 | 长名 | 必填 | 说明 |
|:---|:---|:---|:---|:---|
| iteration | -i | --iteration | 否 | 目标迭代名 |
| platforms | -p | --platforms | 否 | 逗号分隔的端列表 |
| modules | - | --modules | 否 | 逗号分隔的功能模块名 |
| prune | - | --prune | 否 | 清理旧任务 |
| dev-guide | - | --dev-guide | 否 | 生成 DEV_GUIDE.md |
| ignore-specs-update | - | --ignore-specs-update | 否 | 跳过变更检测 |
| dry-run | - | --dry-run | 否 | 预览不创建 |

**提取规则**：
- 支持 `-I Q1`、`--iteration Sprint-3`、`迭代 Q1` 等多种形式
- 支持 `--platforms api,h5`、`只拆 api 和 h5` 等自然语言形式

---

## Step 2: 参数缺失 → 交互式提示

当用户调用 `/split` 但没有提供足够参数时，**不要直接报错**，而是输出友好的提示：

```
🎯 speccore split — 任务拆分

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 当前环境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
迭代: Iteration-001-meeting-system（从 context.json 读取）
已有任务: 0 个
端列表: api, h5-mobile, admin-web（从 CONSTITUTION.md 读取）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -I, --iteration <name>    目标迭代（默认: 当前迭代）
  -p, --platforms <list>    只拆分指定端（如 api,h5）
      --modules <list>      只拆分指定模块（如 "购物车,订单"）
      --prune               清理不匹配的旧任务
      --dev-guide           生成任务级 DEV_GUIDE.md
      --ignore-specs-update 跳过变更检测
      --dry-run             预览不创建

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /split                                  # 拆分当前迭代全部端
  /split -I Q1                            # 拆分指定迭代
  /split --platforms api,h5               # 只拆 api 和 h5 端
  /split --modules "购物车,订单"           # 只拆购物车和订单模块
  /split --prune                          # 清理旧任务后重新拆分
  /split --platforms api --dev-guide      # 拆 api 端 + 生成实现指南

请补充参数后重新调用，或直接调用 /split 使用默认设置。
```

---

## Step 3: 前置校验

参数齐全后，执行以下校验（**不阻断，只提示**）：

### 3.1 检查 analyze 是否完成
```bash
# 检查 ANALYSIS.md 是否存在
if [ ! -f "Iteration-XXX/020-specs/ANALYSIS.md" ]; then
  echo "⚠️  该迭代尚未分析，建议先执行:"
  echo "   speccore analyze --auto -I Iteration-XXX"
  echo ""
  echo "   选项 1: 停止拆分，先执行 analyze"
  echo "   选项 2: 继续拆分（基于 REQUIREMENT.md 直接拆）"
fi
```

### 3.2 检查 020-specs/ 是否有更新（变更检测）
```bash
# 执行 speccore iteration split --dry-run 检测变更
# 如果 020-specs/ 比 030-tasks/ 新，提示用户
```

### 3.3 扫描已有 Task 结构
```bash
# 读取 030-tasks/ 下的 Task 目录
# 提取每个 Task 已有的端（10-backend/{端}, 20-frontend/{端}）
# 用于增量拆分
```

### 3.4 检查端列表有效性
```bash
# 验证用户指定的 platforms 是否在 CONSTITUTION.md 的端列表中
# 如果无效，提示可用端列表
```

---

## Step 4: 生成专属 Prompt

前置校验完成后，生成包含完整上下文的 Prompt：

```
speccore ask "拆分 Iteration-001 的任务。

上下文信息：
- 已有 Task: Task-001（已有端: h5）, Task-002（已有端: admin-web）
- 本次拆分端: api
- 020-specs/ 有更新（晚于上次拆分）
- 功能模块: 全部

请执行：speccore iteration split -I Iteration-001 --platforms api"
```

---

## Step 5: 调用 speccore ask

```bash
execute_command("speccore ask '上述 Prompt'")
```

> ⚠️ **核心原则**：最终仍然调用 `speccore ask`，不要绕过 ask 引擎直接执行 CLI 命令。
> 专属逻辑只做"参数校验 + 上下文准备"，真正的意图理解和执行交给 ask。

---

## 与 speccore-router 的关系

| 场景 | 入口 | 处理方 |
|:---|:---|:---|
| "拆分 Iteration-001 的任务" | 自然语言 | speccore-router → speccore ask |
| "/split -I Iteration-001" | 快捷命令 | spec-split Skill → 参数校验 → speccore ask |
| "/split"（无参数） | 快捷命令 | spec-split Skill → 交互式提示 |

**两者不冲突**：
- router 负责自然语言的意图识别和参数提取
- spec-split 负责快捷命令的参数校验和上下文准备
- 最终都调用 `speccore ask` 执行核心逻辑
