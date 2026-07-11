---
name: spec-platform-add
aliases: [spec-padd, spec-add-platform]
description: 📱 添加新的前端平台类型，自动同步所有关联配置
category: SpecCore
intent:
  triggers:
    keywords: [添加平台, 新增端, 添加前端类型]
    patterns:
      - "添加(.*)平台"
      - "新增(.*)端"
      - "添加(.*)端"
  params:
    - name: name
      extract: "name"
      required: true
      description: "平台唯一标识"
    - name: description
      extract: "description"
      default: ""
      description: "平台描述"
    - name: tech
      extract: "tech"
      default: ""
      description: "技术栈"
    - name: sync_existing
      extract: "sync_existing"
      default: true
      description: "是否同步到现有 Task"
  examples:
    - "添加 tablet 平台"
    - "新增平板端"
    - "添加智能电视端 --tech=React"
---

# /spec-platform-add - 添加前端平台类型

## 命令说明

动态添加新的前端平台类型，自动更新所有关联配置。

**自动更新内容**：
1. `.speccore/config/platforms.yaml` → 添加平台配置
2. 所有现有 Task → 创建 `frontend/{platform}/` 目录
3. `PROJECT_GRAPH.md` → 增加状态列
4. 进度统计 → 自动包含新平台
5. `/spec-execute --platform={name}` → 立即可用

## 使用方式

```bash
/spec-platform-add --name=tablet --description="平板端" --tech="React Native"
```

```bash
添加 tablet 平台
新增平板端
添加智能电视端
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--name=<标识>` | 是 | 平台唯一标识（英文） | `--name=tablet` |
| `--description=<描述>` | 否 | 平台中文描述 | `--description="平板端"` |
| `--tech=<技术栈>` | 否 | 技术栈 | `--tech="React Native"` |
| `--sync-existing` | 否 | 是否同步到现有 Task | `--sync-existing=true` |

## AI 执行流程

### 第一步：验证平台名称

检查 `platforms.yaml` 中是否已存在同名平台，避免重复。

### 第二步：预览影响范围
```markdown
📱 添加新的前端平台类型

平台名称：tablet
平台描述：平板端
技术栈：React Native

影响范围：
- 配置文件：.speccore/config/platforms.yaml（+1 平台）
- 现有 Task：3 个（将创建 frontend/tablet/ 目录）
- PROJECT_GRAPH.md：增加 1 个平台列
- 执行命令：/spec-execute --platform=tablet 可用

是否继续？输入 确认 执行
```

### 第三步：执行添加

| 序号 | 操作 | 说明 |
| :--- | :--- | :--- |
| 1 | 更新 platforms.yaml | 追加平台配置 |
| 2 | 创建 Task 目录 | 为每个现有 Task 创建 `frontend/{platform}/` |
| 3 | 生成 Spec 模板 | 复制 REQ.md/TECH.md/TASK.md 模板 |
| 4 | 更新 PROJECT_GRAPH.md | 增加平台列 |

### 第四步：输出结果
```markdown
✅ 平台类型添加完成！

📁 已更新配置：
- .speccore/config/platforms.yaml

📁 已创建目录（3 个 Task）：
- Task-001/frontend/tablet/
- Task-002/frontend/tablet/
- Task-003/frontend/tablet/

📋 验证：/spec-validate 检查完整性
```
