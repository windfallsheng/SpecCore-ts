---
name: spec-research
aliases: [spec-rs]
description: 🔬 技术调研：用户输入调研问题，AI 自动完成调研全流程
category: SpecCore
intent:
  triggers:
    keywords: [调研, 评估, 选型, 对比]
    patterns:
      - "调研(.*)方案"
      - "调研(.*)技术"
      - "评估(.*)技术"
  params:
    - name: topic
      extract: "topic"
      required: true
      description: "调研主题"
  examples:
    - "调研 OAuth2 方案"
    - "评估 Redis 和 Caffeine"
    - "对比 GraphQL 和 REST"
---
# /spec-research - 技术调研

## 命令说明
用户输入调研问题，AI 自动完成：创建调研任务 → 信息收集 → 方案对比 → 生成报告 → 产出 ADR。

## 使用方式
```bash
/spec-research 调研 OAuth2 接入方案，对比 Auth0 和自建
/spec-research --desc="调研 OAuth2 接入方案"
/spec-research --type=adr
/spec-research --scope=quick
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `<自然语言描述>` | 是* | 直接输入调研问题 | `/spec-research 调研OAuth2` |
| `--desc=<描述>` | 是* | 调研问题描述 | `/spec-research --desc="..."` |
| `--type=<类型>` | 否 | 产出类型（report/adr） | `/spec-research --type=adr` |
| `--scope=<范围>` | 否 | 调研范围（full/quick） | `/spec-research --scope=quick` |

> *注：`<自然语言描述>` 和 `--desc` 必须至少提供一个。

## AI 执行流程

1. 分析调研问题，确定调研范围
2. 创建调研任务（类型为 research）
3. 信息收集（技术文档、社区讨论、最佳实践）
4. 方案对比（优劣分析、适用场景）
5. 生成调研报告或 ADR
6. 沉淀到 PATTERNS/ADR

## 输出示例
```markdown
🔬 技术调研完成！

📋 调研问题：OAuth2 接入方案对比

📊 方案对比：
| 方案 | 优点 | 缺点 | 适用场景 |
| :--- | :--- | :--- | :--- |
| Auth0 | 快速集成、功能丰富 | 成本高、数据外流 | 中小型项目 |
| 自建 | 数据安全、可控 | 开发成本高 | 大型项目 |
| Keycloak | 开源、功能全 | 运维复杂 | 中大型项目 |

📄 产出：
- ADR-001: OAuth2 接入方案选型
- 调研报告：OAuth2 方案对比分析

📁 已沉淀到 PATTERNS/ADR/
```
