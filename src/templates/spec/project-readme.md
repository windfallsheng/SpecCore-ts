# {{projectName}}

> 基于 SpecCore 规范驱动开发

## 快速开始

### 环境准备
- AI 辅助工具: WorkBuddy / Qcoder / Trae
- SpecCore: `npm install -g speccore`

### 开发流程
1. `speccore init` - 初始化项目
2. `speccore iteration create --name=期次名称` - 创建期次
3. 编辑 `00-需求文档/REQUIREMENT.md` 填写需求
4. `speccore iteration split` - 自动拆分 Task
5. `speccore plan --team=3` - 生成调度方案
6. `speccore execute --all` - 批量执行
7. `speccore validate` - 验证合规性
8. `speccore archive --all` - 归档

## 目录结构
```
.speccore/           # 全局层（技术宪法、模式库、项目资产）
期次-XXX/            # 期次层（某一期的所有 Task）
└── Task-XXX/        # 任务层（原子任务）
```

## 相关文档
- [SpecCore 文档](https://github.com/windfallsheng/SpecCore-ts)
- [npm 包](https://www.npmjs.com/package/speccore)
