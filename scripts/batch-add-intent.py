#!/usr/bin/env python3
"""
Batch update SpecCore command files with intent frontmatter.
Adds an 'intent:' section to the YAML frontmatter of each command.
"""

import os
import re

COMMANDS_DIR = "/Users/luzhaosheng/SmartDeveloper/DevWorkspace/AI/SpecCore/templates/commands"

# Intent definitions for each command
INTENT_DEFS = {
    "spec-init.md": """intent:
  triggers:
    keywords: [初始化, 建立项目, 创建项目, 新建项目, 迁移项目]
    patterns:
      - "初始化(这个)?项目"
      - "在(.*)初始化"
      - "建立(.*)项目"
      - "创建(.*)项目"
      - "迁移(.*)项目"
  params:
    - name: path
      extract: "path"
      default: "./"
      description: "项目路径"
    - name: mode
      extract: "mode"
      default: "fresh"
      description: "初始化模式（fresh/migration）"
  examples:
    - "初始化这个项目"
    - "在 ./my-project 初始化"
    - "迁移这个项目"
    - "建立一个新项目\"""",

    "spec-import.md": """intent:
  triggers:
    keywords: [导入, 迁移, 转换, 从代码导入, 从需求导入]
    patterns:
      - "导入(.*)代码"
      - "从(.*)导入"
      - "迁移(.*)项目"
      - "转换(.*)项目"
      - "导入(.*)需求"
  params:
    - name: source
      extract: "source"
      default: "code"
      description: "导入来源（code/prd/prototype）"
    - name: path
      extract: "path"
      default: "./"
      description: "导入路径"
  examples:
    - "导入已有代码"
    - "从需求文档导入"
    - "迁移这个后端项目"
    - "导入 ./my-backend\"""",

    "spec-iteration-create.md": """intent:
  triggers:
    keywords: [创建期次, 新建期次, 开启期次, 添加期次]
    patterns:
      - "创建(.*)期次"
      - "新建(.*)期次"
      - "开启(.*)期次"
      - "添加(.*)期次"
  params:
    - name: name
      extract: "name"
      required: true
      description: "期次名称"
  examples:
    - "创建一个期次"
    - "创建 2026-08 期次"
    - "新建一个订单系统期次\"""",

    "spec-iteration-split.md": """intent:
  triggers:
    keywords: [拆分需求, 分解需求, 拆分文档, 需求拆分]
    patterns:
      - "拆分(.*)需求"
      - "分解(.*)需求"
      - "拆分(.*)文档"
      - "需求拆分"
  params:
    - name: requirement
      extract: "path"
      default: "auto"
      description: "需求文档路径"
    - name: sections
      extract: "sections"
      default: ""
      description: "指定章节（如 2.1,2.3）"
  examples:
    - "拆分需求"
    - "拆分 ./docs/PRD.md"
    - "只看 2.1 和 2.3 节"
    - "拆分这个需求文档\"""",

    "spec-new-task.md": """intent:
  triggers:
    keywords: [创建一个, 新增一个, 做一个, 开发一个, 实现, 添加一个]
    patterns:
      - "创建(.*)任务"
      - "新增(.*)任务"
      - "做一个(.*)"
      - "开发(.*)"
      - "实现(.*)"
  params:
    - name: name
      extract: "name"
      required: true
      description: "任务名称"
    - name: type
      extract: "type"
      default: "auto"
      description: "任务类型（auto: 自动推断 feature/bugfix/research/optimization）"
    - name: desc
      extract: "desc"
      default: ""
      description: "任务描述"
  examples:
    - "创建一个登录任务"
    - "修复登录超时"
    - "调研 OAuth2"
    - "优化查询接口"
    - "做一个支付功能\"""",

    "spec-goal.md": """intent:
  triggers:
    keywords: [完成需求, 实现功能, 交付功能, 完整实现]
    patterns:
      - "完成(.*)需求"
      - "实现(.*)功能"
      - "交付(.*)功能"
  params:
    - name: desc
      extract: "desc"
      required: true
      description: "需求描述"
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
  examples:
    - "完成用户登录需求"
    - "实现支付功能"
    - "做一个会议预定功能\"""",

    "spec-plan.md": """intent:
  triggers:
    keywords: [方案, 计划, 怎么做, 怎么实现, 技术方案, 评估, 估算]
    patterns:
      - "(.*)怎么做"
      - "(.*)怎么实现"
      - "需要(.*)时间"
      - "评估(.*)"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "任务编号"
    - name: team
      extract: "team"
      default: ""
      description: "团队人数"
  examples:
    - "登录模块怎么做"
    - "帮我规划一下"
    - "评估一下工期"
    - "会议室管理怎么实现\"""",

    "spec-execute.md": """intent:
  triggers:
    keywords: [开始, 执行, 干活, 继续, 开发, 做, 跑]
    patterns:
      - "开始(.*)"
      - "继续(.*)"
      - "开发(.*)"
      - "做(.*)"
      - "执行(.*)"
  params:
    - name: all
      extract: "all"
      default: false
      description: "是否执行所有任务"
    - name: assignee
      extract: "assignee"
      default: "auto"
      description: "执行人"
    - name: task
      extract: "task"
      default: "auto"
      description: "任务编号"
    - name: type
      extract: "type"
      default: ""
      description: "任务类型"
  examples:
    - "开始干活"
    - "继续开发"
    - "开发 Task-001"
    - "开发登录"
    - "做下一个"
    - "执行张三的任务"
    - "只做 bugfix 类型的任务\"""",

    "spec-change.md": """intent:
  triggers:
    keywords: [改成, 改为, 调整, 修改, 更新, 变更, 升级, 换成, 替换]
    patterns:
      - "把(.*)改成(.*)"
      - "将(.*)调整为(.*)"
      - "修改(.*)"
      - "升级(.*)"
      - "换成(.*)"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "目标任务（auto=当前任务）"
    - name: desc
      extract: "desc"
      required: true
      description: "变更描述"
    - name: global
      extract: "global"
      default: false
      description: "是否为全局变更"
  examples:
    - "把登录改成验证码登录"
    - "把锁定时间改成10分钟"
    - "升级 Spring Boot 版本"
    - "将 Redis 换成 Caffeine\"""",

    "spec-sync.md": """intent:
  triggers:
    keywords: [同步, 反向同步, 更新Spec, 对齐]
    patterns:
      - "同步(.*)"
      - "更新(.*)Spec"
      - "对齐(.*)"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "任务编号"
  examples:
    - "同步 Spec 和代码"
    - "更新 Task-001 的 Spec"
    - "对齐一下代码和文档\"""",

    "spec-review.md": """intent:
  triggers:
    keywords: [审查, 检查, review, 查看, 核对, 校验]
    patterns:
      - "审查(.*)"
      - "检查(.*)"
      - "查看(.*)"
      - "review(.*)"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "任务编号（auto=当前任务）"
  examples:
    - "审查 Task-001"
    - "检查一下代码"
    - "review 一下会议室管理\"""",

    "spec-validate.md": """intent:
  triggers:
    keywords: [合规, 校验, 检查规范, 格式检查]
    patterns:
      - "合规检查"
      - "校验(.*)"
      - "检查规范"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
    - name: fix
      extract: "fix"
      default: false
      description: "是否自动修复"
  examples:
    - "跑一下合规性检查"
    - "检查规范"
    - "修正合规性问题\"""",

    "spec-progress.md": """intent:
  triggers:
    keywords: [进度, 进展, 完成, 还差, 多少]
    patterns:
      - "进度"
      - "进展"
      - "完成多少"
      - "还有多少"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
    - name: assignee
      extract: "assignee"
      default: ""
      description: "按执行人过滤"
  examples:
    - "进度怎么样了"
    - "当前进度"
    - "张三的任务完成没"
    - "还有多少任务\"""",

    "spec-status.md": """intent:
  triggers:
    keywords: [状态, 情况, 怎么样了]
    patterns:
      - "状态"
      - "情况"
      - "怎么样了"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
  examples:
    - "当前状态"
    - "怎么样了"
    - "项目状态\"""",

    "spec-archive.md": """intent:
  triggers:
    keywords: [归档, 存档, 清理, 整理]
    patterns:
      - "归档"
      - "清理"
      - "整理"
  params:
    - name: task
      extract: "task"
      default: "all"
      description: "任务编号（all=全部已完成）"
  examples:
    - "归档已完成的任务"
    - "清理一下"
    - "归档 Task-001\"""",

    "spec-handover.md": """intent:
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
    - "这个项目要转给别人了\"""",

    "spec-health.md": """intent:
  triggers:
    keywords: [健康, 质量, 评分, 评估]
    patterns:
      - "健康度"
      - "质量"
      - "评分"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
  examples:
    - "项目健康度怎么样"
    - "质量评估"
    - "看看项目状态\"""",

    "spec-report.md": """intent:
  triggers:
    keywords: [报告, 汇报, 生成报告]
    patterns:
      - "生成报告"
      - "汇报"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
    - name: format
      extract: "format"
      default: "markdown"
      description: "输出格式（markdown/html/json）"
  examples:
    - "生成项目报告"
    - "汇报一下项目进展"
    - "生成汇报材料\"""",

    "spec-config.md": """intent:
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
    - "打开严格模式\"""",

    "spec-help.md": """intent:
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
    - "查看所有命令\"""",

    "spec-demo.md": """intent:
  triggers:
    keywords: [示例, 体验, 试一下, demo]
    patterns:
      - "示例"
      - "体验"
      - "试一下"
      - "demo"
  params:
    - name: project
      extract: "project"
      default: "book"
      description: "示例项目类型"
  examples:
    - "体验一下"
    - "试一下示例"
    - "跑个 demo\"""",

    "spec-welcome.md": """intent:
  triggers:
    keywords: [引导, 教程, 第一次, 新手, 入门]
    patterns:
      - "引导"
      - "教程"
      - "第一次使用"
      - "新手入门"
  examples:
    - "我是新手，教我用"
    - "第一次使用，引导一下"
    - "入门教程\"""",

    "spec-template-add.md": """intent:
  triggers:
    keywords: [添加模板, 新增模板, 保存模板]
    patterns:
      - "添加模板"
      - "新增模板"
      - "保存(.*)模板"
  params:
    - name: name
      extract: "name"
      required: true
      description: "模板名称"
    - name: type
      extract: "type"
      required: true
      description: "模板类型（crud/auth/export/report）"
  examples:
    - "添加 CRUD 模板"
    - "保存这个为模板\"""",

    "spec-bugfix.md": """intent:
  triggers:
    keywords: [修复, 解决, bug, 问题, 报错, 错误, 超时]
    patterns:
      - "修复(.*)问题"
      - "修复(.*)bug"
  params:
    - name: desc
      extract: "desc"
      required: true
      description: "Bug 描述"
  examples:
    - "修复登录超时问题"
    - "修复首页加载缓慢"
    - "解决支付回调丢失\"""",

    "spec-research.md": """intent:
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
    - "对比 GraphQL 和 REST\"""",

    "spec-retro.md": """intent:
  triggers:
    keywords: [回顾, 总结, 复盘, 反思]
    patterns:
      - "回顾(.*)"
      - "总结(.*)"
      - "复盘(.*)"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
  examples:
    - "回顾一下这个期次"
    - "总结一下"
    - "复盘会议预定项目\"""",

    # spec.md already has its own complete content, skip
}

def update_file(filepath):
    """Add intent section to a command file's frontmatter."""
    basename = os.path.basename(filepath)
    if basename not in INTENT_DEFS:
        print(f"  SKIP: {basename} (no intent def)")
        return

    intent_block = INTENT_DEFS[basename]

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check if intent already exists
    if '\nintent:' in content:
        print(f"  SKIP: {basename} (intent already exists)")
        return

    # Find the first frontmatter closing --- and insert intent before it
    # The frontmatter ends at the first non-frontmatter ---
    # We need to insert intent before the closing ---
    parts = content.split('---\n', 2)
    if len(parts) < 2:
        print(f"  ERROR: {basename} - bad frontmatter format")
        return

    # parts[1] is the frontmatter body, parts[2] is the rest
    # Insert intent before the closing --- of frontmatter
    new_content = f"---\n{parts[1]}{intent_block}\n---\n{parts[2].lstrip('\n')}" if len(parts) > 2 else f"---\n{parts[1]}{intent_block}\n---"

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"  OK: {basename}")


def main():
    print("=== Batch-updating command files with intent frontmatter ===\n")
    
    for filename in sorted(os.listdir(COMMANDS_DIR)):
        if filename.endswith('.md') and filename != 'spec.md':
            filepath = os.path.join(COMMANDS_DIR, filename)
            update_file(filepath)

    print("\n=== Done ===")


if __name__ == '__main__':
    main()
