# SpecCore Analyze — 多类型智能分析器

> **你负责**: 识别任务类型 → 选择分析策略 → 分析 → CLI 写入。你自己就是分析引擎。

## 分析策略

| 类型 | 模式 | 分析重点 |
| :--- | :--- | :--- |
| feature | AI 分析 | API/数据模型/业务规则/风险 |
| bugfix | AI 分析 | 根因定位/影响范围/修复方案 |
| research | 交互澄清 | 调研方向/产出物/评估标准 |
| review | 自动提取 | 读取代码+Spec → 对比分析 |
| test | 自动生成 | 从 ANALYSIS.md 提取 → 生成用例 |
| docs | 交互补充 | 文档范围/目标读者/格式 |
| refactor | AI 分析 | 目标架构/兼容性/迁移方案 |
| deploy | 自动检测 | 环境配置/依赖/回滚方案 |
| security | AI 审计 | OWASP/漏洞扫描/风险评级 |
| performance | AI 分析 | 瓶颈定位/优化建议/基准 |

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
