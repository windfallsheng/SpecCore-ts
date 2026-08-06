# AI 使用 SpecCore 的规则

> 本文档帮助 AI 代理（TRAE/Claude/Qoder等）正确使用 SpecCore 命令。

## 核心原则

1. **/spec:ask 是智能路由入口** — 用户说"新建迭代"、"分析需求" → 调用 `speccore ask`，不要自己写 mkdir/analyze
2. **不要跨命令猜测** — 每个斜杠命令只做它描述的事，不要自动级联后续步骤
3. **参数从命令描述获取** — /spec:execute 的描述中有完整的参数说明
4. **上下文不足时读取文件** — 查看 .speccore/CONSTITUTION.md、STAFFING.md 等

## 核心流水线

```
init → doc2spec → analyze → split → plan → execute → pr → done → spec2doc
```

## 命令快速参考

| 命令 | 作用 | 参数 | 上游依赖 | 下游产出 |
| :--- | :--- | :--- | :--- | :--- |
| init | 初始化项目 | --interactive/--force/--update | 无 | .speccore/ + 工具集成 |
| doc2spec | Word→Spec MD | -f <文件> --iter <期次> | PRD/Word | 010-requirements/*.md |
| analyze | 需求分析 | -I <期次> --task <任务> | 010-requirements/ | 020-specs/ANALYSIS.md |
| split | 拆分任务 | -i <期次> --owner <人> | 020-specs/ | Task-001~NNN/ |
| plan | 执行计划 | -I <期次> --owner <人> | Task 列表 | plan.json |
| execute | 执行开发 | -i <期次> -t <任务> --type <类型> | REQ.md/TECH.md | 代码 + .issues.md |
| pr | 创建PR | --task <任务> | 代码提交 | Pull Request |
| done | 归档收尾 | --task <任务> | 全部完成 | .verification |
| spec2doc | 导出文档 | -i <期次> -o <文件> | 020-specs/ | Word/PDF |
| retro | 任务回顾 | --task/--all/--owner/--type | done后 | 回顾报告 |
| change | 需求变更 | <描述> --task <任务> --type | 进行中任务 | 变更记录 |
| dev | 智能级联 | --auto/--from/--to | 全部阶段 | 自动全流程 |

## 目录结构

```
Iteration-xxx/
├── 000-overview/     ← 进度跟踪
├── 010-requirements/     ← doc2spec 写入
├── 020-specs/     ← analyze 输出
├── 030-tasks/     ← 开发任务
│   └── Task-*/    ← split 拆分（含 .issues.md .needs-retry）
├── STAFFING.md      ← 人员排期
```

## AI 行为约束

- **不要自己创建目录** — 用 `speccore iteration create -n <名称>`
- **不要自己解析需求** — 用 `speccore analyze -I <期次>`
- **失败时读取 .issues.md** — 不要猜测，看文件里的问题清单
- **续跑用 --resume** — `speccore execute --resume` 自动扫描 .needs-retry