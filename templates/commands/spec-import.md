---
name: spec-import
aliases: [spec-imp]
description: 📥 导入项目到全量层：支持选择性导入、增量同步
category: SpecCore
intent:
  triggers:
    keywords: [导入, 迁移, 引入, 添加项目, 增量同步]
    patterns:
      - "导入(.*)项目"
      - "迁移(.*)项目"
      - "添加(.*)到全量层"
      - "引入(.*)项目"
      - "增量同步"
  params:
    - name: project
      extract: "project"
      required: true
      description: "项目名称"
    - name: path
      extract: "path"
      required: true
      description: "项目路径"
    - name: type
      extract: "type"
      default: "backend"
      description: "项目类型（backend/web/h5/miniapp）"
    - name: scope
      extract: "scope"
      default: "all"
      description: "导入范围：all/core/api"
    - name: ignore
      extract: "ignore"
      default: ""
      description: "忽略的包路径（逗号分隔）"
    - name: update
      extract: "update"
      default: false
      description: "增量同步模式"
  examples:
    - "导入用户服务项目 ./user-service --scope=core"
    - "增量同步 user-service"
    - "导入订单服务 --ignore=*.config.*"
    - "导入前端项目 ./web --type=web"
---

# /spec-import - 导入项目到全量层

## 命令说明

将存量项目导入到全量层，支持：
1. 创建 `GLOBAL/PROJECTS/{project}/` 目录
2. 从代码提取需求，生成 `REQUIREMENT.md`
3. 生成 `METADATA.md`
4. 在 `GLOBAL/INDEX.md` 中追加映射记录
5. **选择性导入**（`--scope`）和**增量同步**（`--update`）

**此命令不生成期次和 Task**。

## 使用方式

### 标准命令格式
```bash
/spec-import --project=用户服务 --path=./user-service --type=backend
/spec-import --project=用户服务 --path=./user-service --scope=core
/spec-import --project=用户服务 --path=./user-service --update
/spec-import --project=前端Web --path=./web --type=web --ignore=*.config.*
```

### 自然语言格式
```bash
导入用户服务项目 ./user-service --scope=core
增量同步 user-service
导入订单服务 --ignore=*.config.*
引入小程序项目 ./miniapp
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--project=<名称>` | 是 | 项目名称（用作目录名） | `--project=用户服务` |
| `--path=<路径>` | 是 | 项目路径 | `--path=./user-service` |
| `--type=<类型>` | 否 | 项目类型，默认 `backend` | `--type=web` |

## 项目类型

| 类型 | 说明 | 扫描重点 |
| :--- | :--- | :--- |
| `backend` | 后端服务 | Controller、Service、Entity、配置 |
| `web` | Web 前端 | 页面、路由、组件、状态管理 |
| `h5` | H5 移动端 | 移动端适配、触摸交互、响应式 |
| `miniapp` | 小程序 | 小程序页面、云函数、API 调用 |

## AI 执行流程

### 第一步：扫描项目代码

扫描指定路径，提取：
- 技术栈版本（`pom.xml` / `package.json` / `requirements.txt`）
- API 接口列表（Controller 注解 / 路由配置）
- 数据模型（Entity / Schema / DTO）
- 业务功能（从 Controller/Service 识别）
- 代码路径映射

### 第二步：创建项目目录
```text
GLOBAL/PROJECTS/{project}/
├── REQUIREMENT.md   # 从代码提取的需求
└── METADATA.md      # 项目元数据
```

### 第三步：分配需求 ID

读取 `GLOBAL/INDEX.md`，获取当前最大需求编号，从 N+1 开始为新需求分配全局唯一 ID。

### 第四步：生成需求文档（含可追溯元数据）

为每个识别到的业务功能生成需求条目，包含完整的元数据和变更历史：

```markdown
### REQ-{自动编号}：{功能名称}

> **元数据（Metadata）**
> | 字段 | 值 |
> | :--- | :--- |
> | 来源（Source） | `/spec-import` \| 项目：{project} \| 导入时间：{当前时间} |
> | 当前版本 | v1.0 |
> | 状态 | 📦 已有实现 |
> | 最后修改 | {当前时间} \| 修改人：AI |
> | 关联期次 | - |
> | 关联 Task | - |

**需求描述**
{从代码注释/逻辑提取的描述}

**验收标准**
{从代码提取的验收标准条目}

**📝 变更历史（Changelog）**
| 版本 | 日期 | 变更内容 | 变更来源 | 修改人 |
| :--- | :--- | :--- | :--- | :--- |
| v1.0 | {当前日期} | 初始创建：从 {project} 代码导入 | `/spec-import` | AI |
```

### 第五步：更新全局索引

在 `GLOBAL/INDEX.md` 的「需求索引」表中追加新行（含版本字段）：
```
| REQ-{N} | {project} | {name} | 📦 已有实现 | v1.0 | - | - | `PROJECTS/{project}/REQUIREMENT.md` |
```

同步更新「项目列表」表中该项目的数据。

### 第六步：更新全局层其他文件

| 文件 | 填充内容 |
| :--- | :--- |
| `OVERVIEW.md` | 追加项目描述 |
| `ARCHITECTURE.md` | 追加服务/模块描述 |
| `TECH_STACK.md` | 追加技术栈信息 |
| `CODE_INDEX.md` | 追加代码路径映射 |

### 第七步：输出导入报告
```markdown
✅ 项目导入完成！

📊 导入摘要：
- 项目名称：用户服务
- 项目类型：backend
- 识别接口：5 个
- 数据模型：3 个
- 业务功能：4 个
- 生成需求：REQ-001 ~ REQ-004

📁 已创建：
- GLOBAL/PROJECTS/user-service/REQUIREMENT.md
- GLOBAL/PROJECTS/user-service/METADATA.md

📋 已更新：
- GLOBAL/INDEX.md（+4 条需求映射）
- GLOBAL/OVERVIEW.md
- GLOBAL/ARCHITECTURE.md
- GLOBAL/TECH_STACK.md
- GLOBAL/CODE_INDEX.md

📋 下一步：
- /spec-global-status 查看全量层状态
- /spec-iteration-from-global 从全量层生成期次
```

## 选择性导入（`--scope`）

大型项目可指定导入范围：

| 范围 | 说明 | 适用场景 |
| :--- | :--- | :--- |
| `all` | 全量导入所有代码（默认） | 首次导入中小型项目 |
| `core` | 只导入核心业务模块 | 大型项目快速上手，跳过工具类 |
| `api` | 只导入 API 接口定义 | 接口文档生成，不关心实现 |

## 忽略路径（`--ignore`）

忽略指定的包路径，多个用逗号分隔：

```bash
/spec-import --project=user-service --path=./ --ignore=*.config.*,*.util.*
```

## 增量同步（`--update`）

只扫描变更的代码文件，识别新增/修改的 API 和功能，**不重建整个文档**：

```markdown
🔄 增量同步模式

检测到以下变更：
- AuthController.java（新增 /api/v1/auth/refresh 接口）
- UserService.java（新增 getUserByEmail 方法）

将更新：
- REQ-001：新增 refreshToken 需求
- REQ-003：新增按邮箱查询功能

是否继续同步？
```

## 导入多个项目的典型流程

```bash
# 第 1 步：导入后端服务
/spec-import --project=user-service --path=./user-service --type=backend
/spec-import --project=meeting-service --path=./meeting-svc --type=backend

# 第 2 步：导入前端项目
/spec-import --project=frontend-web --path=./web --type=web
/spec-import --project=frontend-h5 --path=./h5 --type=h5
/spec-import --project=miniapp --path=./miniapp --type=miniapp

# 第 3 步：查看全量层状态
/spec-global-status

# 第 4 步：按需生成期次
/spec-iteration-from-global --reqs=REQ-001,REQ-004 --name=2026-07-会议预定
```
