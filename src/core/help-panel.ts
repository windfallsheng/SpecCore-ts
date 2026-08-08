// Auto-generated help panel from cli.ts

export const HELP_PANEL = `
┌──────────────────────────────────────────────────────────────┐
│  🧠 = 协作式（支持 --interactive）  ⚡ = 单次执行              │
│  核心流水线: init → doc2spec → analyze → split                 │
│            → plan → execute → pr → done → spec2doc           │
├──────────────────────────────────────────────────────────────┤
│  📥 资产接入                                                  │
│  🚀 init          ⚡ 初始化项目                                │
│  📅 iteration     ⚡ 迭代管理                                  │
│  📝 doc2spec      ⚡ 导入 PRD → Spec MD（AI 精炼推荐）          │
│  📤 spec2doc      ⚡ Spec MD → Word/PDF（AI 排版推荐）          │
│  📦 task new      ⚡ 创建任务（支持批量/调度）                    │
├──────────────────────────────────────────────────────────────┤
│  🤝 协作决策                                                  │
│  🔍 analyze       🧠 需求分析+代码审查（--interactive）             │
│  📊 split         🧠 拆分为Task（--interactive）               │
│  📋 plan          🧠 执行计划（--interactive）                  │
├──────────────────────────────────────────────────────────────┤
│  🚀 执行交付                                                  │
│  💻 execute       ⚡ 自动排序+分批执行                          │
│  🔀 pr            🧠 创建PR（--interactive）                   │
│  ✅ done          🧠 收尾归档（--interactive）                  │
│  🔄 change        🧠 需求变更（--interactive）                  │
├──────────────────────────────────────────────────────────────┤
│  📊 治理 + 调度                                               │
│  ✅ validate      ⚡ 合规校验                                  │
│  ⏰ schedule      ⚡ 定时调度（create/list/daemon）              │
│  🗑  rename       ⚡ 重命名 Task/迭代                           │
├──────────────────────────────────────────────────────────────┤
│  💡 智能入口                                                  │
│  speccore             自适应面板（检测阶段 → 提示下一步）          │
│  speccore ask "..."   自然语言意图识别                          │
│  speccore dev         智能级联：自动检测并执行下一步               │
│  speccore about       版本信息/功能说明/文档链接                  │
│  speccore dashboard   可视化仪表盘（迭代/全局）                 │
└──────────────────────────────────────────────────────────────┘
`;
