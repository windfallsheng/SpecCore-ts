# 变更影响分析流程

## 任务

1. 分析用户输入的变更需求
2. 评估对现有任务的影响范围
3. 识别需要修改的文件和关联模块
4. 生成结构化的影响分析报告

## 用户输入

{{description}}

## 附件

{{attachments}}

## 现有任务

{{tasks}}

## 输出格式

```json
{
  "intent": "new|change",
  "structuredDesc": "结构化需求描述",
  "impactReport": {
    "directTasks": [{"id": "Task-XXX", "name": "", "impact": "描述"}],
    "indirectTasks": [{"id": "Task-XXX", "name": "", "reason": "原因"}],
    "newTasks": [{"name": "", "description": "", "platform": ""}]
  }
}
```

## 规则

- intent=new：新增功能，可能需要创建新任务
- intent=change：修改现有功能，影响已有任务
- 必须评估对 API 契约、数据模型、前端界面的影响
