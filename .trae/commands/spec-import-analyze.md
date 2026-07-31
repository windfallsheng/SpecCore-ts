# /spec-import-analyze — AI 分析导入项目

读取 `speccore import` 生成的骨架文件，用 AI 分析源码，填充需求描述、提取编码规则、完善全局配置。

## 执行步骤

### 1. 读取分析指引
```bash
# 读取 ANALYSIS_PROMPT.md 了解任务
cat .speccore/GLOBAL/PROJECTS/*/ANALYSIS_PROMPT.md
```

### 2. 按任务清单逐项执行

**2.1 功能需求分析** — 编辑 REQUIREMENT.md
- 找到所有 `<!-- AI-ANALYZE: ... -->` 标记
- 浏览源代码目录，理解每个 API 的功能
- 补充功能职责、输入输出、业务规则

**2.2 编码规则提取** — 创建 RULES/ 文件
- 扫描源码中的异常处理模式 → EXCEPTION_HANDLING.md
- 提取 API 命名规范 → API_CONVENTIONS.md
- 提取类/方法命名模式 → NAMING.md
- 检测认证机制 → AUTH.md

**2.3 宪法更新** — 编辑 CONSTITUTION.md
- 检查已自动追加的框架建议
- 补充数据库、缓存、日志等全局规则

### 3. 完成标记
- 在各文件末尾追加 `✅ AI 分析完成`
- 汇报分析结果摘要
