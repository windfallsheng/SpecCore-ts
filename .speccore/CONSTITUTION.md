# 技术宪法

> 本文档是 SpecCore 与 AI 的**最高优先级契约**。analyze/split/execute 均据此执行。
> AI 读取顺序：CONSTITUTION → context.json → 迭代目录

## 端列表（全局权威）

> ⚠️ **端名是全项目唯一的标识符**，所有命令（analyze/split/execute）、目录名（020-specs/{端}/）、模板目录（templates/{level}/{端}/）均使用此处声明的端名。
> 本仓库为 SpecCore CLI 工具（单工程 ts-cli）；下列端名为测试迭代（Iteration-002/003）的示例端，非本工程真实部署端。

| 工程标识 | 描述 | 类型 |
| :--- | :--- | :--- |
| app | 移动端 APP | frontend |
| h5 | 移动 H5 端 | frontend |
| miniapp | 小程序端 | frontend |
| admin | 后台管理端 | frontend |

> **端名规则**：
> - 端名 = 工程名，一一对应
> - 全小写、无空格、用短横线分隔（如 order-service）
> - 类型：frontend / backend / infra
> - 此列表是 analyze/split/execute 的唯一端名来源
> - 「对应端」列引用此列表中的端名，每行只填一个

## 项目信息

> ⚠️ **机器事实源是 `.speccore/PROJECT.yaml` 的 `platforms`**（v8.3.323+）：源码路径→端的映射（变更检测等）以 platforms[].code_path 为准；本表为 AI 契约与兼容回退，两处需保持一致。

> ⚠️ **所有端名称（app/h5/miniapp/admin）必须与 010-requirements/ 子目录名严格一致**

| 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| ts-cli | SpecCore CLI | ./ | git@gitee.com:windfullsheng/spec-core-ts.git | main | — |

> 多工程示例（每个端 = 一个独立工程）:
>
> | 工程 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |
> | :--- | :--- | :--- | :--- | :--- |
> | admin-web | ./packages/admin | git@xxx/admin.git | main | admin |
> | h5-app | ./packages/h5 | git@xxx/h5.git | main | h5 |
> | backend-service | ./packages/backend | git@xxx/backend.git | main | backend |
>
> **关键规则**：
> - 「对应端」列的值必须引用「端列表」中已声明的端名
> - 一一对应：每行一个工程对应一个端名（不填多个）
> - 如果一个服务拆成多个工程（如 user-service + order-service 都属于 backend），应在「端列表」中分别声明

## 技术栈

> 填写规则：**每端一行，只写「已选定」的技术与版本**（决策式声明，不是选项菜单）。
> AI 生成代码时以本表为准；未填写的端回退到端级 TECH.md（analyze 产物）。

| 端 | 语言 | 框架 | 数据存储 | 依据（依赖清单文件） |
| :--- | :--- | :--- | :--- | :--- |
| ts-cli | TypeScript 5 | Node.js（无 Web 框架） | 无（文件落盘） | package.json |

## 命名规范
- 接口（CLI 命令）：speccore {领域} {动作}（如 speccore iteration create）
- 退出码：见「异常码体系」分段约定
- 目录：全小写短横线（unit-staffing）；文件名与默认导出组件同名
- 代码：camelCase 变量/函数；PascalCase 类/接口/组件
- Git 提交：type(scope): subject（feat/fix/docs/refactor/test）

## 异常码体系

> CLI 进程退出码约定——分段规则给 AI 的是「生成能力」，不是几个示例：

| 退出码 | 含义 | 场景 |
| :--- | :--- | :--- |
| 0 | 成功 | 命令正常完成 |
| 1 | 一般错误 | 参数错误、前置校验失败、质量门禁拦截 |
| 10 | 主机 AI 接力 | CLI 输出自包含 prompt 后退出，由宿主 AI 执行并续跑（--resume） |

- 新增退出码遵循：0 成功 / 1 一般错误 / 10 接力；其余按需在 2-9 段内扩展

## Git 分支策略

> ⚠️ **机器事实源是 `.speccore/PROJECT.yaml` 的 `git` 段**（v8.3.322+）：CLI 命令（分支创建、PR、保护分支拦截）只认 PROJECT.yaml；
> 本节是 AI 阅读契约，仅在 PROJECT.yaml 未声明对应字段时作为兼容回退。修改策略请改 PROJECT.yaml，并保持本节语义一致。

- 默认分支: main  (可选: master / develop / trunk / release)
- 任务分支: feature/{Task-ID}
- 发布分支: release/{version}
- 保护分支: main, master, release/*, production
  > 保护分支上禁止直接 commit 和 push，只能通过 PR 合并
  > 支持精确匹配和通配符（如 release/*）
