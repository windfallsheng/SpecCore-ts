---
name: spec-help
aliases: [spec-h, spec-?]
description: 📚 命令帮助：查看所有命令、别名和参数提示
category: SpecCore
intent:
  triggers:
    keywords: [帮助, 怎么用, 教程, 不会用]
    patterns:
      - "帮助"
      - "怎么用"
      - "教程"
  params:
    - name: command
      extract: "command"
      default: ""
      description: "指定命令名称"
  examples:
    - "这个怎么用"
    - "帮助"
    - "查看所有命令"
---
# /spec-help - 命令帮助

## 命令说明

查看所有可用命令、别名和参数说明。当忘记命令或参数时使用。

## 使用方式

```bash
/spec-help
/spec-help --command=spec-execute
/spec-help --search=迭代
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 显示所有命令概览 | `/spec-help` |
| `--command=<命令>` | 否 | 显示指定命令的详细帮助 | `/spec-help --command=spec-execute` |
| `--search=<关键词>` | 否 | 搜索包含关键词的命令 | `/spec-help --search=迭代` |

## 示例

```bash
# 查看所有命令
/spec-help

# 查看某个命令的详细参数
/spec-help --command=spec-execute

# 搜索包含"迭代"的命令
/spec-help --search=迭代
```

## AI 执行流程

### 第一步：解析参数

| 参数 | 说明 |
| :--- | :--- |
| 无参数 | 显示所有命令的概览 |
| `--command=<命令名>` | 显示指定命令的详细帮助 |
| `--search=<关键词>` | 搜索包含关键词的命令 |

### 第二步：输出帮助

#### 无参数：命令概览

```
📚 SpecCore 命令帮助（共 39 个命令）

=== 全量层命令（5 个） ===
命令                              别名               功能
/spec-import                      spec-imp            📥 导入项目到全量层（支持选择性导入+增量同步）
/spec-iteration-from-global       spec-ifg            🧩 从全量层选择需求生成期次
/spec-sync-global                 spec-sg             🔄 期次 ↔ 全量层双向同步
/spec-global-status               spec-gs             🌐 查看全量层状态
/spec-history                     spec-his            📜 查看需求变更历史

=== P0 高级命令（2 个） ===
命令                              别名               功能
/spec-impact                      spec-if             🔗 智能变更影响分析
Git Hooks                        scripts/git-hooks/  🔗 Git 提交 @spec 注释检查

=== 场景级命令（6 个） ===
命令                    别名               功能
/spec-goal             spec-gl, spec-feat  🎯 完整需求交付（从需求到代码）
/spec-bugfix            spec-bf, spec-fix   🐛 快速 Bug 修复（定位→修复→验证）
/spec-research          spec-rs             🔬 技术调研（选型→对比→结论）
/spec-retro             spec-rt             📊 期次回顾（总结→改进→沉淀）
/spec-handover          spec-ho, spec-hand  📤 生成交接文档（进度→交接清单）
/spec-welcome           spec-wc             👋 首次使用引导（8 步完成上手）

=== 原子级命令（19 个） ===
命令                        别名                   功能
/spec-init                 spec-in                🚀 项目初始化
/spec-iteration-create      spec-ic, spec-iter-create  📁 创建期次
/spec-iteration-split       spec-is, spec-iter-split   📂 拆分需求为 Task
/spec-new-task             spec-nt, spec-task     📝 创建单个 Task
/spec-plan                 spec-pl                📅 智能调度
/spec-execute              spec-ex, spec-run      ⚡ 执行控制中心
/spec-change               spec-ch, spec-update   🔄 需求变更级联
/spec-sync                 spec-sy                🔄 逆向同步（代码→Spec）
/spec-review               spec-rv, spec-chk      ✅ 审查产出
/spec-validate             spec-vl, spec-val      📋 规范检查
/spec-progress             spec-pg, spec-prog     📈 进度总览
/spec-status               spec-st, spec-sts      📋 状态看板
/spec-archive              spec-ar, spec-arch     📦 归档任务
/spec-config               spec-cf                ⚙️ 配置管理
/spec-health               spec-hl, spec-hlt      🏥 项目健康度
/spec-demo                 spec-dm                🎮 快速体验示例
/spec-report               spec-rp, spec-rpt      📊 生成项目报告
/spec-template-add         spec-ta                📋 添加代码模板
/spec-help                spec-h, spec-?          📚 命令帮助

=== P1/P2 高级命令（4 个） ===
命令                        别名                   功能
/spec-dashboard            spec-dash, spec-board  📊 生成可视化仪表盘
/spec-baseline             spec-bl, spec-base     📌 需求版本基线（快照/回滚）
/spec-ai-audit             spec-audit, spec-ai    🤖 AI 智能审计
/spec-rename               spec-rn, spec-mv       📝 重命名期次或任务

=== 多平台 & 工具（3 个） ===
命令                        别名                   功能
/spec-platform-add          spec-padd              📱 添加前端平台类型
/spec-index-update          spec-iu                🔄 扫描需求更新 GLOBAL/INDEX
/spec-context               spec-ctx               📋 查看 Task 上下文加载状态

=== 智能入口 ===
/spec                                           🧠 自然语言意图识别（15 种意图类型）

💡 输入 /spec-help --command=spec-execute 查看详细参数
```

#### 指定命令：详细帮助

```
📚 命令帮助：spec-execute

别名：spec-ex, spec-run
分类：执行层
描述：⚡ 执行控制中心：按人员/任务/类型执行开发任务

参数：
--all              执行所有待开发任务
--assignee=<成员>  按执行人过滤
--task=<Task编号>  按任务过滤
--type=<类型>      按类型过滤（feature/bugfix/research/optimization/migration/document）
--priority=<优先级> 按优先级过滤（high/medium/low）
--status=<状态>    按状态过滤（pending/in_progress/review/completed）
--backend          仅后端任务
--frontend         仅前端任务
--interactive      交互式选择
--dry-run          预览模式（不执行）
--resume           断点续传
--parallel=<数量>  并行执行数量
--force            跳过预览，直接执行
--iteration=<期次> 指定期次（默认使用当前期次）

示例：
/spec-execute --all
/spec-execute --assignee=张三 --backend
/spec-execute --task=Task-001,Task-003

关联命令：
/spec-plan    生成调度方案
/spec-review  审查产出
/spec-status  查看状态
```

#### 搜索模式

```
🔍 搜索结果：包含 "迭代" 的命令

/spec-iteration-create  📁 创建期次
/spec-iteration-split   📂 拆分需求为 Task
/spec-retro             📊 期次回顾

💡 输入 /spec-help --command=spec-iteration-create 查看详细参数
```
