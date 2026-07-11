---
name: spec-config
aliases: [spec-cf]
suggestions:
  - "--get=<key>         获取单个配置项"
  - "--set <key>=<value> 设置配置项"
  - "--reset             重置为默认值"
description: ⚙️ 查看或修改 SpecCore 框架配置
category: SpecCore
intent:
  triggers:
    keywords: [配置, 设置, 修改配置]
    patterns:
      - "配置"
      - "设置"
  params:
    - name: key
      extract: "key"
      default: ""
      description: "配置项名称"
    - name: value
      extract: "value"
      default: ""
      description: "配置值"
  examples:
    - "查看配置"
    - "配置一下执行人追踪"
    - "打开严格模式"
---
# /spec-config - 配置管理

## 命令说明
查看或修改框架配置。

## 使用方式
```bash
/spec-config
/spec-config --get=assignee.mode
/spec-config --set assignee.mode=strict
/spec-config --reset
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 查看当前配置 | `/spec-config` |
| `--get=<key>` | 否 | 获取单个配置项 | `/spec-config --get=assignee.mode` |
| `--set <key>=<value>` | 否 | 设置配置项 | `/spec-config --set assignee.mode=strict` |
| `--reset` | 否 | 重置为默认值 | `/spec-config --reset` |

## 配置项

| 配置项 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `assignee.enabled` | `true`/`false` | `true` | 是否启用执行人追踪 |
| `assignee.mode` | `strict`/`loose`/`off` | `loose` | 执行人追踪强制程度 |
| `trace.enabled` | `true`/`false` | `true` | 是否启用双向追溯 |
| `trace.auto_annotate` | `true`/`false` | `true` | 生成代码时是否自动添加 @spec |
| `trace.remote_base_url` | URL | `""` | 远程仓库基础 URL |
| `archive.auto_cleanup` | `true`/`false` | `false` | 归档时是否自动清理 |
| `plan.parallel_suggest` | `true`/`false` | `true` | 是否自动推荐并行策略 |
| `validation.strict_mode` | `true`/`false` | `false` | 合规性检查是否为严格模式 |

## 输出示例
```markdown
⚙️ 当前配置

| 配置项 | 值 |
| :--- | :--- |
| assignee.enabled | true |
| assignee.mode | loose |
| trace.enabled | true |
| trace.auto_annotate | true |
| archive.auto_cleanup | false |
| plan.parallel_suggest | true |
| validation.strict_mode | false |
```
