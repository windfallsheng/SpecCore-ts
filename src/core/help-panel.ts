// Auto-generated help panel from cli.ts

export const HELP_PANEL = `
┌──────────────────────────────────────────────────────────────┐
│  🧠 = 协作式（支持 --interactive）  ⚡ = 单次执行              │
│  核心流水线: init → doc2spec → req-doc → unitize → analyze    │
│            → taskify → plan → execute → verify → pipeline    │
│            → pr → done → spec2doc                            │
├──────────────────────────────────────────────────────────────┤
│  📥 资产接入                                                  │
│  🚀 init          ⚡ 初始化项目                                │
│  📅 iteration     ⚡ 迭代管理                                  │
│  📝 doc2spec      ⚡ 导入 PRD → Spec MD（AI 精炼推荐）          │
│  🔪 unitize       ⚡ 切分需求文档 → 功能单元（features/）        │
│  📦 task new      ⚡ 创建任务                                  │
│  📤 spec2doc      ⚡ Spec MD → Word/PDF（AI 排版推荐）          │
├──────────────────────────────────────────────────────────────┤
│  🤝 协作决策                                                  │
│  🔍 analyze       🧠 需求分析+代码审查+多端合成（--full）       │
│  📊 taskify       🧠 拆功能单元 → 开发任务（Task-*）            │
│  📋 plan          🧠 执行计划（--interactive）                  │
│  📝 req-doc       🧠 需求文档化（口语化 → PRD）                 │
├──────────────────────────────────────────────────────────────┤
│  🚀 执行交付                                                  │
│  💻 execute       ⚡ 自动排序执行                              │
│  ✅ verify        ⚡ 编译+Lint+单测+UI 冒烟（质量门禁）          │
│  🚢 pipeline      ⚡ 合并分支 → 构建 → 部署（环境驱动）          │
│  🔀 pr            🧠 创建PR（--interactive）                   │
│  ✅ done          🧠 收尾归档（--interactive）                  │
├──────────────────────────────────────────────────────────────┤
│  💡 智能入口                                                  │
│  speccore             自适应面板（检测阶段 → 提示下一步）          │
│  speccore ask "..."   自然语言意图识别                          │
│  speccore next        检测进度：提示下一步（只指引）               │
│  speccore run         端到端全自动流水线（13 阶段）               │
│  speccore dashboard   可视化仪表盘（迭代/全局）                 │
│  speccore status      项目状态面板                             │
│  speccore about       版本信息/功能说明/文档链接                  │
│  💡 speccore help --all   查看全部命令（含低频/运维命令）        │
└──────────────────────────────────────────────────────────────┘
`;
