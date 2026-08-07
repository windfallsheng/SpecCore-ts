# SpecCore Ask — AI 自然语言引擎

> **定位**：SpecCore 的通用智能入口。处理复杂的、无法直接映射到单一命令的自然语言请求。
> **核心能力**：意图理解 → 任务分解 → 逐步执行引导 → 结果汇总

---

## 四大模式

```
用户输入自然语言
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ 模式识别                                               │
│                                                        │
│ 1. 命令解释: "execute 命令怎么用"                       │
│    → 返回命令帮助文档                                   │
│                                                        │
│ 2. 意图匹配: "分析 Q1 的需求"                           │
│    → 映射到 speccore analyze -I Q1                      │
│                                                        │
│ 3. 任务指引: "从需求到代码的完整流程是什么"             │
│    → 展示流程步骤 + 当前进度 + 下一步                    │
│                                                        │
│ 4. 复杂编排: "每天晚上8点检查所有迭代进度并生成报告"     │
│    → 分解为多步骤计划 + 建议 schedule 命令               │
└───────────────────────────────────────────────────────┘
```

---

## 详细执行逻辑

### 模式 1: 命令解释
```
用户问某个命令的用法时：
1. 查找命令文档
2. 返回命令的参数说明、示例、注意事项

示例：
用户: "execute 命令怎么用"
响应: speccore execute 是开发执行命令
  用法: speccore execute -t <task> --force
  参数:
    -t: 任务编号 (Task-001, Task-002)
    -i: 迭代名
    --all: 执行全部任务
    --force: 跳过确认
    --resume: 断点续跑
  示例:
    speccore execute -t Task-001 --force
    speccore execute --all --force
```

### 模式 2: 意图匹配
```
尝试将用户意图映射到已知命令（同 speccore-router 的映射逻辑）

如果匹配成功：
→ 输出对应的 CLI 命令

如果匹配失败：
→ 进入模式 3（任务指引）
```

### 模式 3: 任务指引
```
当用户问"怎么做"、"流程是什么"时：

1. 展示完整流水线：
   init → doc2spec → analyze → split → plan → execute → pr → done

2. 读取当前状态：
   - 从 context.json 获取当前阶段
   - 从 PROJECT_GRAPH.md 获取进度

3. 高亮当前步骤，给出明确指令：

   📋 SpecCore 开发流程
   ━━━━━━━━━━━━━━━━━━━━━━━━
   ✅ 1. init            — 项目已初始化
   ✅ 2. doc2spec        — 需求已导入
   ▶ 3. analyze         — ⬅ 你在这里
   ⬜ 4. split           — 下一步
   ⬜ 5. plan
   ⬜ 6. execute
   ⬜ 7. pr
   ⬜ 8. done

   👉 当前应该执行: speccore analyze -I Q1
```

### 模式 4: 复杂编排
```
对于无法一步完成的复杂请求：

1. 将用户意图分解为步骤序列
2. 检查每步的前置条件
3. 生成步骤计划
4. 输出完整的执行序列

示例：
用户: "帮我从零开始创建一个会议室预订系统"

分解：
  Step 1: speccore init                           # 初始化项目
  Step 2: 编辑 CONSTITUTION.md 定义技术栈          # 手动配置
  Step 3: speccore iteration create -n Meeting     # 创建迭代
  Step 4: [用户拖入 PRD 文档]
  Step 5: speccore doc2spec -f PRD.docx --iter Meeting
  Step 6: speccore analyze -I Meeting             # 需求分析
  Step 7: [编辑 STAFFING.md 分配人员]
  Step 8: speccore iteration split -I Meeting      # 拆分任务
  Step 9: speccore plan -I Meeting                # 生成计划
  Step 10: speccore execute --all --force          # 执行开发

👉 建议: 使用 speccore dev 逐步推进，每次完成一步后说"继续"
```

---

## 上下文感知

```
ask 引擎总是先读取以下文件获取上下文：
1. .speccore/CONSTITUTION.md    — 项目技术栈和规范
2. .speccore/local/context.json — 当前迭代、任务、状态
3. PROJECT_GRAPH.md             — 任务进度
4. 迭代下的 STAFFING.md         — 人员配置
```

---

## 输出格式

```
简单匹配 → 直接输出 CLI 命令
复杂流程 → 分步骤展示 + 每步的 CLI 命令
无法处理 → 诚实告知 + 建议替代方案
```
