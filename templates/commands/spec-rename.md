---
name: spec-rename
aliases: [spec-rn, spec-mv]
description: 📝 重命名期次或任务，自动更新所有关联引用
category: SpecCore
intent:
  triggers:
    keywords: [重命名, 改名, 修改名称, 更换名称]
    patterns:
      - "把(.*)改成(.*)"
      - "重命名(.*)为(.*)"
      - "修改(.*)名称为(.*)"
      - "将(.*)更名为(.*)"
      - "(.*)改名为(.*)"
      - "把(.*)重命名为(.*)"
  params:
    - name: target
      extract: "target"
      required: true
      description: "当前名称（期次或任务）"
    - name: new_name
      extract: "new_name"
      required: true
      description: "新名称"
    - name: batch
      extract: "batch"
      default: false
      description: "批量重命名模式"
    - name: pattern
      extract: "pattern"
      default: ""
      description: "批量替换的模式"
    - name: replacement
      extract: "replacement"
      default: ""
      description: "批量替换的目标字符串"
  examples:
    - "把期次-2026-07-会议预定改成期次-2026-07-会议室系统"
    - "重命名 Task-001-用户登录 为 Task-001-用户认证"
    - "修改期次名称为 2026-08-订单系统"
    - "将 Task-001-用户登录 更名为 Feature-001-用户认证"
    - "批量重命名 Task- 为 Feature-"
---

# /spec-rename - 重命名期次或任务

## 命令说明

重命名期次（`期次-XXX`）或任务（`Task-XXX`），自动更新所有关联引用。

**核心能力**：
1. 自动识别目标类型（期次 / 任务）
2. 自动更新所有关联引用，包括：
   - 目录重命名
   - `GLOBAL/INDEX.md` 中的名称
   - `PROJECT_GRAPH.md` 中的名称
   - `ITERATIONS/README.md` 中的名称
   - 所有 Spec 文件中的溯源引用
   - 代码文件中的 `@spec` 注释
3. 预览影响范围，确认后执行
4. 支持单个重命名和批量重命名

## 使用方式

### 单个重命名
```bash
/spec-rename --target="期次-2026-07-会议预定" --new-name="期次-2026-07-会议室系统"
/spec-rename --target="Task-001-用户登录" --new-name="Task-001-用户认证"
```

### 自然语言格式
```bash
把期次-2026-07-会议预定改成期次-2026-07-会议室系统
重命名 Task-001-用户登录 为 Task-001-用户认证
修改期次名称为 2026-08-订单系统
将 Task-001-用户登录 更名为 Feature-001-用户认证
```

### 批量重命名
```bash
/spec-rename --batch --pattern="Task-" --replacement="Feature-"
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--target=<当前名称>` | 是* | 当前期次或任务名称 | `--target="期次-2026-07-会议预定"` |
| `--new-name=<新名称>` | 是* | 新名称 | `--new-name="期次-2026-07-会议室系统"` |
| `--batch` | 否 | 批量重命名模式 | `--batch` |
| `--pattern=<模式>` | 否 | 批量替换的匹配模式 | `--pattern="Task-"` |
| `--replacement=<替换>` | 否 | 批量替换的目标字符串 | `--replacement="Feature-"` |

> *单个重命名时 `--target` 和 `--new-name` 必填；批量重命名时 `--batch`、`--pattern`、`--replacement` 必填。

## AI 执行流程

### 模式一：单个重命名

#### 第一步：识别目标类型

AI 自动判断目标是期次还是任务：

| 名称特征 | 类型 |
| :--- | :--- |
| 包含 `期次-` | 期次 |
| 包含 `Task-` | 任务 |

#### 第二步：验证目标存在

- 期次：检查 `期次-XXX/` 目录是否存在
- 任务：检查 `期次-XXX/Task-XXX/` 目录是否存在

若不存在，提示错误并终止。

#### 第三步：预览影响范围
```markdown
📋 重命名预览

目标类型：期次
旧名称：期次-2026-07-会议预定
新名称：期次-2026-07-会议室系统

影响范围：
- 目录重命名：1 个目录
- 索引更新：2 个文件（GLOBAL/INDEX.md, ITERATIONS/README.md）
- 溯源引用更新：约 12 处
- @spec 注释更新：约 8 处
- PROJECT_GRAPH.md 更新：1 处

是否继续？
输入 确认 执行，查看 查看详情，取消 终止
```

#### 第四步：执行重命名

| 序号 | 操作 | 说明 |
| :--- | :--- | :--- |
| 1 | 目录重命名 | `mv 旧目录 新目录` |
| 2 | 更新 GLOBAL/INDEX.md | 替换所有出现的旧名称 |
| 3 | 更新 ITERATIONS/README.md | 替换期次名称 |
| 4 | 更新 PROJECT_GRAPH.md | 替换任务名称（如适用） |
| 5 | 更新 Spec 溯源引用 | 替换所有 Spec 文件中的路径引用 |
| 6 | 更新代码 @spec 注释 | 替换代码中的 @spec-title |

#### 第五步：输出结果
```markdown
✅ 重命名完成！

📁 目录已重命名：
- 期次-2026-07-会议预定 → 期次-2026-07-会议室系统

📁 已更新的文件：
- .speccore/GLOBAL/INDEX.md（1 处）
- .speccore/ITERATIONS/README.md（1 处）
- 期次-2026-07-会议室系统/00-期次总览/PROJECT_GRAPH.md（1 处）
- 所有 Spec 文件中的溯源引用（12 处）
- 所有代码文件中的 @spec 注释（8 处）

📋 验证：
/spec-validate --iteration=期次-2026-07-会议室系统
```

### 模式二：批量重命名

#### 第二步预览
```markdown
📋 批量重命名预览

操作：将 Task- 替换为 Feature-
影响范围：

期次-2026-07-会议预定：
  Task-001-用户登录 → Feature-001-用户登录
  Task-002-会议室管理 → Feature-002-会议室管理
  Task-003-会议预定 → Feature-003-会议预定

总计：3 个任务将重命名

是否继续？输入 确认 执行，取消 终止
```

## 自然语言示例

| 用户输入 | AI 识别 | 执行命令 |
| :--- | :--- | :--- |
| "把期次-2026-07-会议预定改成期次-2026-07-会议室系统" | 重命名期次 | `spec-rename --target="期次-2026-07-会议预定" --new-name="期次-2026-07-会议室系统"` |
| "重命名 Task-001-用户登录 为 Task-001-用户认证" | 重命名任务 | `spec-rename --target="Task-001-用户登录" --new-name="Task-001-用户认证"` |
| "修改期次名称为 2026-08-订单系统" | 重命名当前期次 | `spec-rename --target=当前期次 --new-name="2026-08-订单系统"` |
| "批量重命名 Task- 为 Feature-" | 批量重命名 | `spec-rename --batch --pattern="Task-" --replacement="Feature-"` |

## 错误处理

| 场景 | 处理方式 |
| :--- | :--- |
| 目标不存在 | 提示错误并终止 |
| 新名称已存在 | 提示冲突并询问是否覆盖 |
| 重命名过程中断 | 支持断点续传，重试失败的操作 |

## 注意事项

1. **重命名会触发 Git 变更**：涉及目录重命名和文件内容修改，建议在重命名后及时提交
2. **批量重命名是高风险操作**：建议在操作前备份或确保代码已提交
3. **重命名后建议运行验证**：`/spec-validate` 检查所有关联是否正确
