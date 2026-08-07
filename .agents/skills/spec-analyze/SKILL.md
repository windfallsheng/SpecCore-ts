# SpecCore Analyze — 多类型智能分析器

> **你负责**: 识别任务类型 → 选择分析策略 → 分析 → CLI 写入。你自己就是分析引擎。

## 分析策略

> **自动 + 交互双模式**: 所有类型都支持。自动模式适用于确定性分析，交互模式需要用户确认/修改后再写入。

| 类型 | 自动分析 | 交互确认点 |
| :--- | :--- | :--- |
| feature | API/模型/规则自动提取 | 用户确认 API 清单完整性 |
| bugfix | 根因/影响自动分析 | 用户确认根因和优先级 |
| review | 代码+Spec自动对比 | 用户确认审查范围和标准 |
| test | 从API自动生成用例 | 用户补充边界测试 |
| docs | 范围自动推断 | 用户确认目标读者和格式 |
| refactor | 架构自动检测 | 用户确认目标架构 |
| research | 方向自动建议 | 用户确认调研产出物 |
| deploy | 环境自动检测 | 用户确认配置和回滚方案 |
| security | OWASP自动扫描 | 用户确认审计范围 |
| performance | 瓶颈自动定位 | 用户确认基准和优化方向 |

## 执行流程（自动 + 交互）

```
1. execute_command("speccore analyze --prompt -I {iter} --task {taskId}")

2. 你分析并生成内容

3. 展示给用户:
   "📋 {type} 分析结果:
    {概要}
    是否确认？[确认/修改某项/重新分析]"

4. 用户交互循环:
   - "确认" → 跳到步骤 5
   - "修改 API 清单" → 你重新生成该部分 → 回到步骤 3
   - "补充 XX 内容" → 你补充 → 回到步骤 3
   - "重新分析" → 回到步骤 2

5. 写入:
   execute_command("cat /tmp/analysis.md | speccore analyze --apply - -I {iter} --task {taskId}")

6. 展示 + 推荐下一步
```

## 执行流程

```
1. execute_command("speccore analyze --prompt -I {iter} --task {taskId}")

   exitCode=10 → 你分析
   exitCode=11 → 展示参数列表 → 用户选

2. 取 [SPECCORE_PROMPT] 上下文（含任务类型）

3. 根据任务类型生成对应分析:

   feature → ANALYSIS.md (API + 数据模型 + 业务规则)
   bugfix  → BUG_ANALYSIS.md (根因 + 影响 + 方案)
   review  → REVIEW_PLAN.md (范围 + 检查清单)
   test    → TEST_PLAN.md (用例清单 + 覆盖矩阵)
   ...以此类推

4. 写入:
   Write /tmp/analysis.md
   execute_command("cat /tmp/analysis.md | speccore analyze --apply - -I {iter} --task {taskId}")

5. 展示 + 推荐下一步
```

## 各类型分析模板

### bugfix — 根因分析
```
## Bug 分析
### 根因定位 | 影响范围 | 修复方案
### 回归风险 | 验证方法
```

### review — 审查计划
```
## 审查计划
### 审查范围（文件列表）| 检查清单 | 关注点
```

### test — 测试计划  
```
## 测试计划
### 用例清单（从API/边界提取）| 覆盖矩阵 | 测试数据
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 10 | 你分析 |
| 11 | 展示参数列表 |
| 其他 | [重试/跳过/停止] |
