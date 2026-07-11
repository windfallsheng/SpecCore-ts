---
name: spec-handover
aliases: [spec-ho, spec-hand]
description: 📤 生成交接文档：自动生成项目交接文档
category: SpecCore
intent:
  triggers:
    keywords: [交接, 转交, 移交, 交付]
    patterns:
      - "交接"
      - "转交"
      - "生成交接文档"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
  examples:
    - "生成交接文档"
    - "准备交接材料"
    - "这个项目要转给别人了"
---
# /spec-handover - 生成交接文档

## 命令说明
自动生成项目交接文档，包含：功能清单、代码索引、技术债务、模式库索引、遗留问题。

## 使用方式
```bash
/spec-handover
/spec-handover --iteration=2026-07-会议预定
/spec-handover --scope=all
/spec-handover --include-code
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 使用当前期次 | `/spec-handover` |
| `--iteration=<期次>` | 否 | 指定期次 | `/spec-handover --iteration=2026-07-会议预定` |
| `--scope=<范围>` | 否 | 交接范围（all/iteration） | `/spec-handover --scope=all` |
| `--include-code` | 否 | 包含代码仓库信息 | `/spec-handover --include-code` |

## AI 执行流程

1. 读取期次所有 Task 的信息
2. 生成功能清单（从 REQ.md 提取）
3. 生成代码索引（从 CODE_INDEX.md 提取）
4. 汇总技术债务（从 PATTERNS/ADR 提取）
5. 列出遗留问题（待开发的 Task）

## 输出示例
```markdown
📤 交接文档 - 2026-07-会议预定

📋 功能清单
| 功能 | 状态 | 负责人 | 说明 |
| :--- | :--- | :--- | :--- |
| 用户登录 | ✅ 已完成 | 张三 | 手机号+密码登录 |
| 会议室管理 | ✅ 已完成 | 李四 | CRUD 管理 |
| 会议预定 | 🟦 开发中 | 王五 | 支持冲突检测 |

📂 代码索引
- 后端：my-backend/src/main/java/com/company/meeting/
- 前端：my-frontend/src/views/

📊 技术债务
- ADR-001: OAuth2 方案待决策
- 模式 P-002: 分页查询模式待优化

⚠️ 遗留问题
- Task-004: 审批流程（待开发）
- Task-005: 消息通知（待开发）

📄 生成文件：handover-2026-07-会议预定.md
```
