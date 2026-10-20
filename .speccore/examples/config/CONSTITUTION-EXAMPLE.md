## 字段对照总表

> **AI 必读**：以下表格明确 CONSTITUTION.md 各字段与 PROJECT.yaml 的对应关系。
> 机器执行以 PROJECT.yaml 为事实源（CLI 只读 PROJECT.yaml）；CONSTITUTION.md 是 AI 阅读契约，仅在 PROJECT.yaml 未声明对应字段时作兼容回退。两处内容需保持语义一致。

### 项目信息表字段

| CONSTITUTION 列 | PROJECT.yaml 字段 | 语义说明 | 示例 |
|:---|:---|:---|:---|
| 工程标识 | `name` | 全局唯一技术标识 | `admin-web` |
| 工程类型 | `type` | AI 据此生成针对性内容 | `Java服务` |
| 工程名 | `description` | 人类可读的业务名称 | `预订服务` |
| 项目名称 | `project_name` | 给人和 AI 看的业务名称 | `食堂后台管理` |
| 项目描述 | `project_desc` | 工程的详细说明 | `核心业务服务...` |
| 工程源码路径 | `code_path` | 相对项目根目录 | `./packages/backend` |
| **涉及需求端** | `requirement_unit` | **需求文档名称/标识，仅作 AI 参考** | `订单系统PRD` |
| 备注 | `notes` | 额外信息 | `核心业务` |

### Git 配置表字段

| CONSTITUTION 列 | PROJECT.yaml 字段 | 语义说明 | 示例 |
|:---|:---|:---|:---|
| Git 仓库 | `git_repo` | 仓库地址 | `git@github.com:org/repo.git` |
| 默认分支 | `default_branch` | 默认分支名 | `main`、`develop` |
| 保护分支 | `protected_branches` | 禁止直接 push 的分支列表 | `main,release/*` |

### 公共默认值机制

- 「Git 公共配置」章节定义公共默认值
- 「Git 配置」表中用 `—` 表示使用该字段的公共默认值
- 各工程只写和公共配置不同的字段

---

## 端列表（全局权威）

> ⚠️ **工程标识是全项目唯一的端标识符**，所有命令（analyze/taskify/execute）、目录名（020-specs/{端}/）、模板目录（templates/{level}/{端}/）均使用此处声明的端名。

| 工程标识 | 描述 | 工程类型 |
| :--- | :--- | :--- |
| admin-web | 后台管理端 | Web管理后台 |
| h5-mobile | 移动 H5 端 | H5移动端 |
| miniapp | 小程序端 | 微信小程序 |
| backend-api | 后台 API 服务 | Java服务 |

> **端名规则**：
> - 工程标识 ≠ 工程名：工程标识是唯一技术标识（如 admin-web），工程名是业务名称（如 "预订服务"）
> - 全小写、无空格、用短横线分隔（如 order-service）
> - 工程类型：AI 据此生成针对性内容（见下方工程类型枚举）
> - 此列表是 analyze/taskify/execute 的唯一端名来源

---

## 项目信息

> ⚠️ **机器事实源是 `.speccore/PROJECT.yaml` 的 `platforms`**（v8.3.323+）：源码路径→端的映射（变更检测等）以 platforms[].code_path 为准；本表为 AI 契约与兼容回退，两处需保持一致。

| 工程标识 | 工程类型 | 工程名 | 项目名称 | 项目描述 | 工程源码路径 | 涉及需求端 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| admin-web | Web管理后台 | 后台管理 | 运营后台 | 运营人员使用的后台管理系统 | ./packages/admin | 后台管理端需求文档 | 核心系统 |
| h5-mobile | H5移动端 | H5商城 | 移动商城 | 用户端H5购物页面 | ./packages/h5 | 移动端需求文档 | 高优先级 |
| miniapp | 微信小程序 | 小程序 | 微信小程序 | 微信内嵌小程序商城 | ./packages/miniapp | 小程序端需求文档 | 待上架 |
| backend-api | Java服务 | 订单服务 | 订单与支付 | 订单创建、支付、退款核心服务 | ./packages/backend | 订单系统PRD | 核心业务 |

> **字段说明**：
> - **工程标识**：全局唯一技术标识（如 admin-web），全小写、无空格、短横线分隔
> - **工程类型**：AI 据此生成针对性内容（如 Java服务、H5移动端、Web管理后台）
> - **工程名**：人类可读的业务名称（如 "预订服务"、"后台管理"）
> - **项目名称**：给人和 AI 看的业务名称（如"食堂后台管理"、"商户入驻系统"）
> - **项目描述**：工程的详细说明、补充信息（如"核心业务服务，处理订单全生命周期"）
> - **工程源码路径**：相对于项目根目录的代码位置（如 ./packages/backend）
> - **涉及需求端**：需求文档名称/标识，仅作 AI 参考（如"后台管理端需求文档"、"订单系统PRD"）。说明本工程大概会出现在哪些需求文档中
> - **备注**：额外信息、特殊说明、TODO 等

---

## 技术栈

> 填写规则：**每端一行，只写「已选定」的技术与版本**（决策式声明，不是选项菜单）。
> AI 生成代码时以本表为准；未填写的端回退到端级 TECH.md（analyze 产物）。

| 端 | 语言 | 框架 | 数据存储 | 依据（依赖清单文件） |
| :--- | :--- | :--- | :--- | :--- |
| backend-api | Java 17 | Spring Boot 3.x | MySQL 8 | pom.xml |
| admin-web | TypeScript | Vue 3 | — | package.json |
| h5-mobile | TypeScript | Vue 3 | — | package.json |
| miniapp | JavaScript | 原生小程序 | — | package.json |

> 可选技术域（约束参考，非已选）：后端语言 Java/TypeScript/Go/Python；框架 Spring Boot/NestJS/Gin/FastAPI；前端框架 Vue/React/Angular；数据存储 MySQL/PostgreSQL/MongoDB；缓存 Redis。

## 异常码体系

> 错误码为 4 位数字，按段划分——**分段规则给 AI 的是「生成能力」，不是几个示例**：

| 段 | 范围 | 归属 |
| :--- | :--- | :--- |
| 1xxx | 1000-1999 | 用户模块 |
| 2xxx | 2000-2999 | 订单模块 |
| 3xxx | 3000-3999 | 支付模块 |

- 首位 = 模块段，后三位 = 段内序号；错误码全项目唯一，跨端共用同一套编号
- 示例（演示用，按真实模块替换上表）：1001 用户不存在 / 2001 订单不存在 / 3001 支付超时

---

## Git 公共配置

> 公共默认值。各工程在「Git 配置」表中只写与公共配置不同的字段，未填写的字段自动使用此处默认值。
> 用 `—` 表示使用公共默认值。

### 默认配置

| 默认分支 | 保护分支 |
| :--- | :--- |
| main | main,release/* |

### 分支类型

> 定义各种分支类型及其创建源分支。**分支名格式：`{类型}/{前缀}-{任务名}-{后缀}`**
> - `{类型}/` = 类型自带（如 hotfix/、feature/）
> - `{前缀}` = 任务名前的前缀（可选）
> - `{任务名}` = 如 Task-001-修复登录
> - `{后缀}` = 任务名后的后缀（可选）
>
> 示例：配置了前缀 `api-`、后缀 `-urgent`，任务名为 `Task-001`，则分支名为 `hotfix/api-Task-001-urgent`

| 类型 | 前缀（可选） | 后缀（可选） | 创建源 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| feature | — | — | develop | 新功能开发 |
| bugfix | — | — | develop | 修复开发环境 Bug |
| release | — | — | develop | 版本发布准备 |
| hotfix | — | — | main | 生产环境紧急修复 |
| support | — | — | main | 长期支持历史版本 |

> **分支类型说明**：
> - **分支名格式**：`{类型}/{前缀}-{任务名}-{后缀}`，前缀和后缀均可选
> - **前缀列**：任务名前的前缀（如 `api-`、`backend-`），不填则无
> - **后缀列**：任务名后的后缀（如 `-urgent`、`-review`），不填则无
> - **feature**：日常功能开发，从 develop 创建，完成后合并回 develop
> - **bugfix**：修复开发中的 Bug，从 develop 创建，完成后合并回 develop
> - **release**：准备发布版本，从 develop 创建，完成后合并到 main + develop
> - **hotfix**：生产环境紧急修复，从 main 创建，完成后合并到 main + develop
> - **support**：长期支持历史版本，从 main 创建，用于维护历史版本
> - 可自定义添加其他类型（如 refactor、docs、test 等）

---

## Git 配置

> 按工程标识对应。未配置的字段使用「Git 公共配置」中的默认值。
> 用 `—` 表示使用公共默认值。

| 工程标识 | Git 仓库 | 默认分支 | 保护分支 | 分支前缀 | 备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| admin-web | git@github.com:myorg/admin-web.git | — | — | — | 核心系统 |
| h5-mobile | git@github.com:myorg/h5-mobile.git | — | — | — | 高优先级 |
| miniapp | git@github.com:myorg/miniapp.git | — | — | — | 待上架 |
| backend-api | git@github.com:myorg/backend.git | — | — | — | 核心业务 |

> **字段说明**：
> - **工程标识**：引用「项目信息」表中的工程标识，一一对应
> - **Git 仓库**：仓库地址（如 git@github.com:org/repo.git、https://...）
> - **默认分支**：如 main、master、develop。填 `—` 表示使用公共默认值
> - **保护分支**：禁止直接 push，只能通过 PR 合并（支持通配符如 release/*）。填 `—` 表示使用公共默认值
> - **分支前缀**：功能分支前缀（如 feature/）。填 `—` 表示使用公共默认值
> - **备注**：额外说明

---

## 通用业务规则

> 跨功能、跨迭代的通用业务规则。详细规则请维护在 `.speccore/GLOBAL/BUSINESS_RULES/` 目录下，AI 会自动读取并注入 Prompt（按端过滤）。
> 此处只放核心规则概述，确保 AI 每次执行都能看到。

### 角色体系概览

| 角色 | 权限级别 | 可访问功能 | 特殊约束 |
|:---|:---|:---|:---|
| 超级管理员 | L5 | 全部 | 不可删除自身账号 |
| 管理员 | L4 | 用户管理、系统配置 | — |
| 运营人员 | L3 | 订单、商品、内容 | 不可修改价格 |
| 普通用户 | L1 | 浏览、下单 | 仅自己的数据 |

### 核心约束

- 所有删除必须为软删除（保留 `deleted_at` 字段）
- 所有金额字段使用分存储，禁止 float
- 所有状态流转必须记录操作人 + 操作时间
- 详细规则见 `.speccore/GLOBAL/BUSINESS_RULES/` 目录（通用放 `*-common.md`，端级放 `{端名}.md`）

---

> 📌 **使用说明**：
> 1. 复制本示例内容到 `CONSTITUTION.md`，根据实际项目修改
> 2. 修改后运行 `speccore update` 更新配置结构（Git 策略以 `.speccore/PROJECT.yaml` 的 `git` 段为机器事实源）
> 3. 子任务目录下的 `.meta/git-config` 可覆盖全局配置（见目录结构说明）
