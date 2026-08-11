# 需求变更与新增交互设计

> 版本: v1.0 | 日期: 2026-08-11

## 1. 设计目标

用户在开发过程中经常需要：
- **变更需求**：修改已有功能的需求（产品调整、客户反馈、bug 修复）
- **新增需求**：添加全新功能模块

传统做法需要用户手动找到对应 Task、修改多个 Spec 文件、同步上层文档。本设计通过**智能匹配 + 澄清环节 + 一站式流程**，让用户一句话完成需求变更或新增。

## 2. 核心架构

```
用户输入（自然语言 / 附件文件）
        │
        ▼
┌─────────────────────┐
│   Ask 引擎（路由层）   │  意图识别 → change 命令
│   priority: 100      │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   Inbox 扫描         │  读取 .speccore/inbox/ 新文件
│   + --file 附件加载   │  支持 md/txt/xlsx/图片
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   澄清环节           │  --prompt 输出 Prompt → AI 澄清
│   (Clarification)    │  --response 接收 AI 结果
│                      │  无 AI 时本地分析兜底
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   意图分流           │
│  ┌───────┬─────────┐│
│  │ 变更   │ 新增     ││
│  │change │ new     ││
│  └───┬───┴────┬────┘│
└──────┼────────┼─────┘
       │        │
       ▼        ▼
  智能匹配    创建任务
  受影响任务   + 追加需求
  + 批量变更   + 更新依赖图
       │        │
       ▼        ▼
  上层同步    引导分析
  + 重执行    + 执行
```

## 3. 命令用法

### 3.1 基础用法

```bash
# 变更（自动匹配受影响任务）
speccore change "密码规则改为8位含大小写"

# 变更（指定任务）
speccore change "密码规则调整" --task=Task-003

# 新增需求
speccore change "加一个消息通知功能"

# 全局变更
speccore change "所有接口统一加时间戳" --global
```

### 3.2 附件支持

```bash
# 从 inbox 自动读取（默认）
cp password-policy.md .speccore/inbox/
speccore change "密码规则调整"

# 指定外部文件
speccore change "登录调整" --file=~/Desktop/design.md

# 多个附件
speccore change "密码调整" --file=policy.md,design.xlsx

# 混合：inbox + 指定文件
speccore change "调整" --file=extra.md
```

### 3.3 AI 澄清模式

```bash
# 输出澄清 Prompt（Skill/AI 消费）
speccore change "密码调整" --prompt

# 接收 AI 澄清结果
speccore change "密码调整" --response='{"intent":"change",...}'
```

### 3.4 控制选项

| 选项 | 说明 |
|:---|:---|
| `--file=a.md,b.xlsx` | 指定附件（逗号分隔） |
| `--no-inbox` | 跳过 `.speccore/inbox/` 扫描 |
| `--reprocess` | 强制重新处理所有 inbox 文件 |
| `--task=Task-003` | 直接指定目标任务 |
| `--global` | 全局层变更 |
| `--no-requirement` | 不同步到 REQUIREMENT.md |
| `--no-analysis` | 不同步到 ANALYSIS.md |
| `--interactive` | 交互模式（预览 → 确认） |
| `--dry-run` | 仅预览影响范围 |
| `--prompt` | 输出澄清 Prompt 到 stdout |
| `--response` | 接收 AI 澄清结果 |

## 4. Inbox 收件箱设计

### 4.1 目录结构

```
.speccore/
├── inbox/                    ← 需求收件箱
│   ├── password-policy.md    ← 待处理
│   ├── notification.xlsx     ← 待处理
│   └── .manifest.json        ← 处理记录
```

### 4.2 Manifest 追踪

```json
{
  "files": {
    "password-policy.md": {
      "processedAt": "2026-08-11T10:30:00Z",
      "mtime": "2026-08-11T10:00:00.000Z",
      "linkedTo": ["Task-003"],
      "action": "change"
    }
  },
  "lastScan": "2026-08-11T10:30:00Z"
}
```

### 4.3 文件状态规则

| 场景 | 处理 |
|:---|:---|
| 新文件出现在 inbox | 读取并处理 |
| 已处理文件未修改 | 跳过，提示「已处理」 |
| 已处理文件被修改（mtime 变化） | 重新读取，视为更新 |
| 文件被删除 | 从 manifest 中清除 |
| `--file` 指定的文件 | 不受 manifest 管理，每次都读 |
| `--reprocess` | 忽略 manifest，重新处理所有 |

### 4.4 支持的文件格式

| 格式 | 处理方式 |
|:---|:---|
| `.md` / `.txt` / `.json` / `.yaml` | 直接读取文本 |
| `.xlsx` / `.xls` | xlsx 库解析为 CSV 文本 |
| `.png` / `.jpg` / `.jpeg` | 记录路径，Prompt 中标记为图片引用 |
| 其他 | 尝试文本读取，失败则仅记录路径 |

## 5. 澄清环节设计

### 5.1 三层处理

| 层 | 职责 | 实现 |
|:---|:---|:---|
| CLI 层（确定性） | 本地意图检测、关键词提取、影响分析、文件操作 | `detectIntent()` + `analyzeImpact()` |
| AI 层（智能） | 理解模糊描述、补全细节、生成结构化需求 | `--prompt` / `--response` 循环 |
| 用户层（确认） | 确认或修改澄清结果 | 交互确认 |

### 5.2 澄清 Prompt 结构

```markdown
# 需求澄清

## 用户输入
原始描述: 密码改复杂一点

## 附件内容
### password-policy.md
[文件内容...]

## 现有任务
- Task-003: 用户认证
- Task-005: 个人中心

## 请分析并输出 JSON:
{
  "intent": "change | new",
  "structuredDesc": "结构化需求描述",
  "keyPoints": ["要点1", "要点2"],
  "acceptanceCriteria": ["验收标准1"],
  "impactReport": {
    "directTasks": [{"id": "Task-003", "reason": "...", "affectedFiles": ["REQ.md"]}],
    "indirectTasks": [{"id": "Task-005", "reason": "..."}],
    "unaffectedTasks": ["Task-001", "Task-002"]
  },
  "suggestedActions": ["重新执行 Task-003"]
}
```

### 5.3 本地兜底

当没有 AI 澄清时，系统使用本地分析：
- `detectIntent()`: 根据描述前缀区分变更/新增
- `extractKeywords()`: 提取 2 字以上中文/英文关键词
- `analyzeImpact()`: 读取每个任务的 REQ.md + TECH.md + TASK.md + .task-status，双向依赖图分析，输出三级影响报告

## 6. 意图识别路由

### 6.1 Ask 引擎触发词

`change` 命令在意图识别中优先级最高（priority: 100）：

| 触发词 | 示例输入 | 路由 |
|:---|:---|:---|
| 改成、改为 | "把密码改成8位" | → change |
| 调整、修改、更新 | "密码规则调整" | → change |
| 变更、升级、替换 | "接口升级" | → change |
| 加、改了、改一下 | "加个消息通知" | → change |
| 加(.+)、改了(.+) | "加了个批量删除" | → change |

### 6.2 内部分流

change 命令内部通过 `detectIntent()` 再区分：

| 描述前缀 | 意图 | 处理 |
|:---|:---|:---|
| 新增、加、创建、实现 | `new` | 创建新任务流程 |
| 改成、调整、修改、修复 | `change` | 智能匹配变更流程 |

## 7. 变更流程

### 7.1 智能匹配变更

```
用户: speccore change "密码规则调整"

系统:
  🔍 智能匹配到 2 个受影响任务:
     Task-003 用户认证 (相关度: 3)
     Task-005 个人中心 (相关度: 1)

  ✅ 已更新 5 个文件（事务保护）
     Task-003/00-specs/REQ.md
     Task-003/00-specs/CHANGELOG.md
     Task-003/00-specs/TASK.md
     Task-005/00-specs/REQ.md
     Task-005/00-specs/CHANGELOG.md

  📌 任务状态从 done 回退为 needs-rework
  → 已同步到 REQUIREMENT.md
  → 已同步到 ANALYSIS.md

  💡 下一步:
     speccore execute --task=Task-003,Task-005 --force
```

**执行步骤**：
1. 提取关键词 → 扫描所有任务 REQ.md → 计算相关度
2. 补充 PROJECT_GRAPH.md 中的间接依赖
3. 对每个匹配任务：更新 REQ.md + CHANGELOG.md + TASK.md
4. 状态回退：done → needs-rework
5. 默认同步上层文档（REQUIREMENT.md + ANALYSIS.md）
6. 给出一键重执行命令

### 7.2 版本号递增

每次变更自动从 CHANGELOG.md 提取最新版本号并递增 minor 版本：
- v1.0 → v1.1 → v1.2 → ...

## 8. 新增流程

```
用户: speccore change "加一个消息通知功能"

系统:
  🆕 检测到新增需求意图

  ✅ 新任务已创建: Task-008
     📄 Task-008/00-specs/REQ.md
     📄 Task-008/00-specs/TASK.md

  💡 下一步:
     speccore analyze --task=Task-008     # 分析技术方案
     speccore execute --task=Task-008 --force  # 执行任务
```

**执行步骤**：
1. 检测意图为「新增」
2. 调用 `nextTaskId()` 生成新任务 ID
3. 创建 `00-specs/REQ.md`（含需求描述 + 验收标准）
4. 创建 `00-specs/CHANGELOG.md`（v1.0 初始）
5. 创建 `00-specs/TASK.md`（状态: 待开发）
6. 追加到 `020-specs/REQUIREMENT.md`
7. 更新 `000-overview/PROJECT_GRAPH.md`
8. 引导 analyze → execute

## 9. 执行后自动回顾

任务执行完成后，系统自动为每个已完成任务生成回顾报告（RETRO.md）：

```
执行完成 → executionVerifyLoop → 自动生成 RETRO.md
```

覆盖三条执行路径：
- `executeWithProgress`（常规执行）
- `executeBatchMode`（批量执行）
- `executeResume`（断点续传）

## 10. 文件保护策略

| 机制 | 说明 |
|:---|:---|
| 事务保护 | 所有文件修改通过 `FileTransaction` 原子写入，失败回滚 |
| 版本追踪 | CHANGELOG.md 自动记录每次变更的版本号 |
| 状态回退 | done → needs-rework，防止遗漏重执行 |
| 依赖检测 | 自动分析 PROJECT_GRAPH.md 找出间接影响 |

## 11. 影响分析设计（ImpactReport）

### 11.1 三级影响分类

| 级别 | 含义 | 处理 |
|:---|:---|:---|
| 🔴 直接影响 | 代码/Spec 直接涉及变更内容 | 需修改 Spec + 重新执行 |
| 🟡 间接影响 | 通过依赖链间接涉及 | 建议回归测试 |
| 🟢 无影响 | 与变更内容无关 | 不处理 |

### 11.2 分析过程

```
analyzeImpact(desc, iterDir, taskBase)
  │
  ├── 读取每个任务的:
  │   ├── REQ.md（需求规格）
  │   ├── TECH.md（技术方案）
  │   ├── TASK.md（任务状态）
  │   └── .task-status（执行状态）
  │
  ├── 关键词匹配评分
  │
  ├── 正向依赖: findDependentTasks（下游）
  │
  └── 反向依赖: findReverseDependencies（上游）
```

### 11.3 澄清结果持久化

澄清 = 需求分析，分析结果写入文件：

| 场景 | 写入文件 | 内容 |
|:---|:---|:---|
| 新增需求 | 任务 `REQ.md` | 结构化描述 + 功能要点 + 验收标准 |
| 需求变更 | `020-specs/CHANGE_SUMMARY.md` | 影响报告 + 受影响任务 + 变更原因 |
| 任务级变更 | `020-specs/CHANGE_SUMMARY.md` + 任务 `REQ.md` | 同上 |

## 12. 统一智能匹配（resolver.ts）

所有命令共用 `resolveTask()` / `resolveIteration()` 解析名称：

| 匹配层级 | 示例 |
|:---|:---|
| 精确匹配 | `Task-001-订单管理` → 直接命中 |
| 前缀匹配 | `Task-001` → `Task-001-订单管理` |
| 关键词搜索 | `订单` → 在任务名 + REQ.md 内容中搜索 |
| 多匹配处理 | 列出候选，提示用户精确指定 |

已接入命令：change / execute / lifecycle / validate / verify

## 13. 执行后质量门禁

### 13.1 强制检查项

execute 完成后自动运行，不可跳过：

| 检查 | 阻塞性 | Node.js | Java | Go | Python |
|:---|:---|:---|:---|:---|:---|
| 编译检查 | 🔒 阻塞 | `tsc --noEmit` | `mvn compile` | `go build` | `py_compile` |
| Lint | 🟡 警告 | `eslint` | `checkstyle` | `golangci-lint` | `flake8/ruff` |
| 单元测试 | 🟡 警告 | `jest/vitest` | `mvn test` | `go test` | `pytest` |
| 依赖完整性 | 🟡 警告 | `npm ls` | - | - | - |
| 安全扫描 | 🟡 警告 | `npm audit` | - | - | - |
| Spec 一致性 | 🟡 警告 | 关键词匹配 | - | - | - |

### 13.2 失败修复循环

```
质量门禁 → 编译失败？→ [SPECCORE_EXEC] AI 修复 → 再跑门禁 → 最多 3 轮
           3 轮仍失败 → 标记 needs-rework，人工介入
```

## 14. 相关文件

| 文件 | 职责 |
|:---|:---|
| `src/commands/change.ts` | 变更/新增主逻辑 |
| `src/commands/verify.ts` | 代码验证命令入口 |
| `src/core/inbox.ts` | Inbox 收件箱管理 + 影响分析类型 |
| `src/core/resolver.ts` | 统一智能匹配模块 |
| `src/core/verify-engine.ts` | 代码验证引擎 + 质量门禁 |
| `src/core/intent-recognition.ts` | Ask 引擎意图识别 |
| `src/core/state.ts` | 任务扫描（scanTasks） |
| `src/core/context.ts` | 迭代上下文管理 |
| `src/core/transaction.ts` | 文件事务保护 |
| `src/core/global-counters.ts` | 任务 ID 生成 |
| `src/commands/init.ts` | 初始化（创建 inbox 目录） |
