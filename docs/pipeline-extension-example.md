# Pipeline Engine 扩展示例

## 概述

SpecCore CLI 的 Pipeline Engine 现在支持多个命令的 Pipeline 模式，包括 `analyze`、`split`、`execute` 和 `dev` 命令。

## 支持的命令

### 1. analyze 命令

```bash
# Phase 1→Phase 2 自动执行模式
speccore analyze --prompt --pipeline -I <iteration>

# 恢复之前的 Pipeline
speccore analyze --prompt --pipeline --resume -I <iteration>
```

### 2. split 命令

```bash
# 启动任务拆分 Pipeline
speccore iteration split --pipeline --prompt -I <iteration>

# 恢复之前的拆分 Pipeline
speccore iteration split --pipeline --resume -I <iteration>
```

### 3. execute 命令

```bash
# 启动任务执行 Pipeline
speccore execute --pipeline --prompt --task <task-id> -I <iteration>

# 恢复之前的执行 Pipeline
speccore execute --pipeline --resume --task <task-id> -I <iteration>
```

### 4. dev 命令

```bash
# 启动开发 Pipeline
speccore dev --pipeline -I <iteration>

# 恢复之前的开发 Pipeline
speccore dev --pipeline --resume -I <iteration>
```

## Pipeline 引擎架构

Pipeline 引擎使用状态机设计，支持多步骤自动执行：

```typescript
// 状态接口
interface PipelineState {
  currentStep: string;      // 当前步骤
  steps: string[];          // 所有步骤列表
  completedSteps: string[]; // 已完成步骤
  iteration: string;        // 迭代名称
  name: string;             // 流水线名称
  createdAt: string;        // 创建时间
  updatedAt: string;        // 更新时间
}

// 步骤定义
interface PipelineStepDef {
  id: string;               // 步骤 ID
  name: string;             // 步骤显示名
  next: string | null;      // 下一步 ID（null = 结束）
  condition?: () => Promise<boolean> | boolean; // 条件判断
}
```

## 工厂函数

Pipeline 引擎提供了多个工厂函数：

- `createAnalyzePipeline()` - 分析命令 Pipeline
- `createSplitPipeline()` - 拆分命令 Pipeline
- `createExecutePipeline()` - 执行命令 Pipeline
- `createGlobalAnalyzePipeline()` - 全局分析 Pipeline

## 扩展指南

要为新命令添加 Pipeline 支持：

1. 在 `pipeline-engine.ts` 中添加新的工厂函数
2. 在命令选项接口中添加 `pipeline?: boolean` 选项
3. 在命令实现中添加 Pipeline 模式处理逻辑
4. 在 `--prompt` 模式后添加 Pipeline 继续指令
5. 在 `--apply` 模式后添加 Pipeline 推进逻辑

## 状态管理

Pipeline 状态保存在 `.speccore/local/.pipeline-{iteration}.json` 文件中，支持断点续跑。

## 错误处理

- Pipeline 失败时会保留状态，可通过 `--resume` 恢复
- 支持条件分支，可根据条件跳过某些步骤
- 完整的日志记录和状态跟踪