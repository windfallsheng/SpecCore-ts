# 技术宪法

> 本项目遵循 SpecCore 框架规范

## 技术栈

### 后端
- 语言：Java / TypeScript / Go / Python
- 框架：Spring Boot / NestJS / Gin / FastAPI
- 数据库：MySQL / PostgreSQL / MongoDB
- 缓存：Redis

### 前端
- 框架：Vue / React / Angular
- 状态管理：Pinia / Redux / NgRx
- UI 组件：Element Plus / Ant Design

## 命名规范
- 接口：/api/v1/{模块}/{操作}
- 错误码：4 位数字，按模块划分
- 数据库：snake_case
- 代码：camelCase / PascalCase

## 代码规范（会被 execute 自动注入）

<!-- spec-rule: exception-handler -->
- 统一异常：所有 Controller 方法抛出 BusinessException
- 全局捕获：@ControllerAdvice 统一处理，返回 { code, message, data }
- 禁止：直接返回 null 或不处理异常
<!-- /spec-rule -->

<!-- spec-rule: response-format -->
- 统一返回类型：Result<T> = { code: Integer, message: String, data: T }
- Controller 方法签名：public Result<XxxDTO> methodName(...)
<!-- /spec-rule -->

<!-- spec-rule: orm -->
- ORM 框架：MyBatis-Plus 3.5
- 数据访问：XxxRepository extends BaseMapper<Xxx>，禁止手写 SQL
- 软删除：@TableLogic 注解，查询自动过滤已删除记录
<!-- /spec-rule -->

<!-- spec-rule: naming -->
- Controller：XxxController
- Service：XxxService（接口）+ XxxServiceImpl（实现）
- Repository：XxxRepository extends BaseMapper<Xxx>
- DTO：CreateXxxDTO / UpdateXxxDTO / XxxPageDTO
<!-- /spec-rule -->

<!-- spec-rule: validation -->
- 参数校验：Controller 层 @Valid + JSR-303 注解
- DTO：@NotBlank / @NotNull / @Pattern
- 失败返回：MethodArgumentNotValidException → 400 + 错误详情
<!-- /spec-rule -->

<!-- spec-rule: git-branch -->
- 分支命名格式: {YYYYMMDD}-{任务名}-{姓名缩写}
- 示例: 260715-订单管理-zs
- 开发前自动创建分支: git checkout -b {日期}-{任务名}-{缩写}
- 姓名缩写参见 PROJECT/TEAM.md
<!-- /spec-rule -->

## 异常码体系
| 错误码 | 含义 | 场景 |
| :--- | :--- | :--- |
| 1001 | 用户不存在 | 登录时手机号未注册 |
| 1002 | 密码错误 | 登录密码不匹配 |
| ... | ... | ... |

## AI 操作规则（对话中自动遵守）

当用户在对话中请求修改 Spec 文件时，AI 必须执行**两阶段确认**流程：

### 第一阶段：变更分析（用户确认后再进入第二阶段）
AI 输出结构化的分析报告：

- **变更内容**: 将要修改哪些文件，具体改什么（新增/修改/删除）
- **影响范围**: 检查 PROJECT_GRAPH.md，列出受影响的依赖任务
- **风险评级**: 🟢低 / 🟡中 / 🔴高，附评级理由
- **确认**: "确认继续？" 等待用户回复

### 第二阶段：执行计划（用户确认后才写入文件）
AI 列出具体执行步骤：

- **修改清单**: 每个文件的具体改动（含 diff 摘要）
- **关联更新**: 是否需要同步更新 API_CONTRACT.yaml / TECH.md / 期次总览
- **变更履历**: 将在每个被修改文件末尾追加的条目预览
- **确认**: "开始执行？" 等待用户回复

用户确认后，AI 一次性完成所有写入，并输出结果摘要。

### 写入前自动备份
AI 修改任何 Spec 文件前，必须先复制原文件为同目录下的 .bak 副本（如 REQ.md → REQ.md.bak）。
用户说「回滚」时，AI 从 .bak 恢复原文件。备份保留 24 小时后清理。

### 自动追加变更履历
修改 Spec 文件后，在文件末尾追加表格：

| 时间 | 变更内容 | 类型 | 版本 |
| :--- | :--- | :--- | :--- |
| 2026-07-21 | + POST /api/v1/orders/batch 批量创建 | 新增接口 | v1.1 |

### 完成后提示
- 需要重新执行的命令（execute / sync --detect / validate）
- 受影响的下游任务清单

### 禁止行为
- ❌ 跳过第一阶段直接展示修改内容
- ❌ 用户在第一阶段未确认就继续
- ❌ 修改 Spec 后不追加变更履历
- ❌ 修改 Spec 后不告知影响的下游任务

## 核心宪法与冲突裁决

### 核心原则
- **反向同步铁律**：代码与 Spec 冲突时，必须先更新 Spec，再修改代码
- **Spec 是唯一事实源**：文档和代码冲突时，错的一定是代码

### 冲突裁决规则
| 等级 | 场景 | 处理方式 |
| :--- | :--- | :--- |
| L1 | 明确冲突 | 立即修正代码 |
| L2 | Spec 缺陷 | 暂停，提交裁决 |
| L3 | 环境不可行 | 升级至架构评审 |
