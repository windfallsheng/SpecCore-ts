---
name: spec-baseline
aliases: [spec-bl, spec-base]
description: 📌 需求版本基线：创建需求快照，支持对比和回滚
category: SpecCore
intent:
  triggers:
    keywords: [基线, 快照, 版本, 回滚]
    patterns:
      - "创建基线"
      - "打快照"
      - "回滚"
      - "(.*)基线"
  params:
    - name: name
      extract: "name"
      required: true
      description: "基线名称"
    - name: restore
      extract: "restore"
      default: ""
      description: "回滚到的基线名称"
    - name: req
      extract: "req"
      default: ""
      description: "指定回滚的需求 ID"
    - name: compare
      extract: "compare"
      default: ""
      description: "对比的基线名称"
    - name: list
      extract: "list"
      default: false
      description: "查看基线列表"
  examples:
    - "创建基线 2026-Q3-Release"
    - "打快照 2026-07-05"
    - "查看基线列表"
    - "回滚 REQ-001 到 2026-Q3-Release"
    - "对比基线 2026-Q3-Release"
---

# /spec-baseline - 需求版本基线

## 命令说明

创建当前全量层需求的快照（基线），支持查看基线列表、对比差异和回滚到指定基线。

**核心能力**：
1. **创建基线**：保存当前全量层所有需求的状态
2. **查看基线**：列出所有已创建的基线
3. **对比基线**：查看当前状态与基线的差异
4. **回滚基线**：将指定需求回滚到基线状态

## 基线存储结构
```text
GLOBAL/BASELINES/
├── README.md                 # 基线索引
├── 2026-Q3-Release/
│   ├── INDEX.md              # 当时的需求索引快照
│   ├── PROJECTS/             # 各项目需求快照
│   └── meta.yaml             # 基线元数据
└── 2026-07-05/
    └── ...
```

## 使用方式

### 标准命令格式
```bash
/spec-baseline --name=2026-Q3-Release
/spec-baseline --list
/spec-baseline --compare=2026-Q3-Release
/spec-baseline --restore=2026-Q3-Release --req=REQ-001
```

### 自然语言格式
```bash
创建基线 2026-Q3-Release
打快照 2026-07-05
查看基线列表
对比基线 2026-Q3-Release
回滚 REQ-001 到 2026-Q3-Release
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--name=<名称>` | 是* | 基线名称 | `--name=2026-Q3-Release` |
| `--list` | 否 | 查看所有基线 | `--list` |
| `--compare=<基线>` | 否 | 对比当前与指定基线 | `--compare=2026-Q3-Release` |
| `--restore=<基线>` | 否 | 回滚到指定基线 | `--restore=2026-Q3-Release` |
| `--req=<ID>` | 否 | 指定回滚的需求 ID | `--req=REQ-001` |

## AI 执行流程

### 创建基线
```markdown
📌 创建基线：2026-Q3-Release

📊 快照范围：
- 需求总数：12 条
- 涉及项目：3 个
- 进行中期次：1 个

已保存到：GLOBAL/BASELINES/2026-Q3-Release/
```

### 查看基线列表
```markdown
📌 基线列表

| 基线名称 | 创建时间 | 需求数 | 项目数 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| 2026-Q3-Release | 2026-07-05 14:30 | 12 | 3 | Q3 发布基线 |
| 2026-07-05 | 2026-07-05 10:00 | 8 | 2 | 临时快照 |
```

### 对比基线
```markdown
📊 对比基线：2026-Q3-Release

| 需求 ID | 基线状态 | 当前状态 | 差异 |
| :--- | :--- | :--- | :--- |
| REQ-001 | ✅ 已实现 | ✅ 已实现 | 无 |
| REQ-002 | 🔲 待开发 | ✅ 已实现 | 状态变更 |
| REQ-003 | - | ✅ 已实现 | 🆕 新增 |

变更摘要：1 条状态变更，1 条新增需求
```

### 回滚基线
```markdown
🔄 回滚 REQ-001 到基线 2026-Q3-Release

当前状态：v1.2 / ✅ 已实现（含验证码功能）
基线状态：v1.0 / ✅ 已实现（无验证码）

⚠️ 此操作将回滚需求描述、验收标准和状态到基线版本。

是否确认回滚？输入 确认 回滚，查看 查看差异，取消 终止
```
