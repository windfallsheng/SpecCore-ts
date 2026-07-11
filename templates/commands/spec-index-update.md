---
name: spec-index-update
aliases: [spec-iu, spec-reindex]
description: 🔄 扫描所有需求文档，自动更新 GLOBAL/INDEX.md
category: SpecCore
intent:
  triggers:
    keywords: [更新索引, 重建索引, 刷新索引]
    patterns:
      - "更新索引"
      - "重建索引"
      - "刷新索引"
  params:
    - name: dry_run
      extract: "dry_run"
      default: false
      description: "预览模式"
  examples:
    - "更新索引"
    - "重建索引"
    - "刷新索引"
---

# /spec-index-update - 扫描需求文档更新索引

## 命令说明

扫描 `GLOBAL/PROJECTS/` 下所有项目的 `REQUIREMENT.md`，自动重建 `GLOBAL/INDEX.md`。

**使用场景**：
- 手动修改了 `REQUIREMENT.md`，需要同步索引
- 批量导入后索引不完整
- 数据迁移或恢复后重建索引

## 使用方式

```bash
/spec-index-update
/spec-index-update --dry-run
```

```bash
更新索引
重建索引
```

## AI 执行流程

### 第一步：扫描项目目录

遍历 `GLOBAL/PROJECTS/` 下所有项目。

### 第二步：提取需求条目

从每个 `REQUIREMENT.md` 中提取所有 `### REQ-XXX` 条目。

### 第三步：重建索引

更新 `GLOBAL/INDEX.md` 中的「需求索引」和「项目列表」。

### 第四步：输出结果
```markdown
✅ 索引已更新！

📊 扫描结果：
- 项目数：3 个
- 需求数：12 条
- 新增需求：0 条
- 状态更新：2 条
```
