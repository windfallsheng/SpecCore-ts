---
name: spec-sync-global
aliases: [spec-sg, spec-sync-g]
description: 🔄 期次与全量层双向同步
category: SpecCore
intent:
  triggers:
    keywords: [同步全量, 同步全局, 更新全量层]
    patterns:
      - "同步(.*)到全量层"
      - "更新全量层"
      - "同步全量"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称（auto=当前活跃期次）"
    - name: direction
      extract: "direction"
      default: "to_global"
      description: "同步方向（to_global/from_global）"
  examples:
    - "同步 2026-07-会议预定 到全量层"
    - "更新全量层"
    - "同步全量"
---

# /spec-sync-global - 期次与全量层双向同步

## 命令说明

在期次和全量层之间进行双向同步。同步链路：

```text
GLOBAL/INDEX.md ←→ PROJECTS/{project}/REQUIREMENT.md ←→ 期次-XXX/REQUIREMENT.md ←→ 代码
                          ↑                                   ↑
                    /spec-sync-global                    /spec-sync
```

**同步更新目标**：
- 需求内容：更新 `GLOBAL/PROJECTS/{project}/REQUIREMENT.md`
- 状态和关联：更新 `GLOBAL/INDEX.md`

## 使用方式

### 标准命令格式
```bash
/spec-sync-global --iteration=2026-07-会议预定
/spec-sync-global --iteration=2026-07-会议预定 --direction=to_global
/spec-sync-global --direction=from_global
```

### 自然语言格式
```bash
同步 2026-07-会议预定 到全量层
更新全量层
同步全量
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--iteration=<名称>` | 否 | 期次名称，默认当前活跃期次 | `--iteration=2026-07-会议预定` |
| `--direction=<方向>` | 否 | `to_global`（期次→全量）或 `from_global`（全量→期次） | `--direction=to_global` |

## AI 执行流程

### 第一步：读取当前期次

读取 `期次-{name}/00-需求文档/REQUIREMENT.md`，获取需求列表。

### 第二步：查询索引

读取 `GLOBAL/INDEX.md`，查找期次中各需求对应的项目信息。

### 第三步：对比差异

对比期次需求与对应 `GLOBAL/PROJECTS/{project}/REQUIREMENT.md` 中的内容，列出差异。

### 方向一：to_global（期次 → 全量层）
```markdown
🔄 准备同步 {期次名称} → 全量层

📊 检测到以下变更：

| 需求 ID | 需求名称 | 来源项目 | 变更内容 |
| :--- | :--- | :--- | :--- |
| REQ-001 | 用户登录 | user-service | + 新增"验证码校验"功能 |
| REQ-001 | 用户登录 | user-service | ~ 验收标准更新（3 条 → 5 条） |
| REQ-003 | 会议室管理 | meeting-service | ~ API 入参新增 `duration` 字段 |

涉及项目：user-service（1 条）、meeting-service（1 条）

将更新：
- GLOBAL/PROJECTS/user-service/REQUIREMENT.md
- GLOBAL/PROJECTS/meeting-service/REQUIREMENT.md
- GLOBAL/INDEX.md（状态同步）

是否同步到全量层？输入 确认 同步
```

### 方向二：from_global（全量层 → 期次）
```markdown
🔄 准备同步 全量层 → {期次名称}

📊 检测到全量层中的变更：

| 需求 ID | 需求名称 | 变更内容 |
| :--- | :--- | :--- |
| REQ-001 | 用户登录 | ~ 优先级从"高"调整为"中" |
| REQ-004 | 支付功能 | + 新增"支持微信支付" |

⚠️ REQ-004 不在当期期次中，将跳过。

是否同步到期次？输入 确认 同步
```

### 第四步：执行同步（变更追加模式）

**核心原则**：每次变更必须追加变更历史，永不覆盖原有内容。

用户确认后，逐项处理每个变更需求：

1. **读取当前内容**：获取全量层中该需求的当前元数据、描述、验收标准、变更历史
2. **识别变更类型**：
   - 描述变更 → 更新描述文本，追加变更记录
   - 验收标准变更 → 新增/修改 AC 条目，追加变更记录
   - 状态变更 → 更新状态字段，追加变更记录
   - 新增需求 → 在文档末尾追加新条目，标记来源为期次
3. **追加变更历史**：在需求的「变更历史」表格末尾追加新行（不删除旧行）
4. **更新元数据**：版本号 +0.1，更新最后修改时间
5. **不删除、不覆盖任何原有内容**

**变更历史追加格式**：
```markdown
| v1.2 | 2026-07-07 | 新增"验证码校验"需求 | 期次-2026-07-会议预定 | AI |
```

6. **更新索引**：更新 `GLOBAL/INDEX.md` 中对应需求的「状态」「版本」字段
7. **更新全局日志**：更新 `GLOBAL/CHANGELOG.md`，记录本次同步操作

### 第五步：输出同步报告
```markdown
✅ 同步完成！（变更追加模式）

📋 同步摘要：
- 方向：期次 → 全量层
- 期次：2026-07-会议预定
- 同步需求：2 条
- 变更类型：描述变更（1）、验收标准变更（1）

📁 已更新（追加模式）：
  GLOBAL/PROJECTS/user-service/REQUIREMENT.md
    REQ-001：v1.1 → v1.2（追加 1 条变更记录）
  GLOBAL/PROJECTS/meeting-service/REQUIREMENT.md
    REQ-003：v1.0 → v1.1（追加 1 条变更记录）

📋 GLOBAL/INDEX.md 版本同步：v1.2 → v1.3

📜 建议 Git 提交信息：
```
chore(global): sync from iteration 2026-07-会议预定

变更详情：
- REQ-001: 新增验证码校验需求
- REQ-003: API 入参新增 duration 字段
