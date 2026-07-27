# 从 Vibe Coding 到 Spec Coding：一套 AI-SDD 工程化实战方案

> 读完本文，你将获得一套经过验证的 AI 研发工具链，以及可在 Qcoder、WorkBuddy、Trae、Cursor、Claude Code、OpenCode 中直接运行的完整配置。

---

## 写在前面

去年，Andrej Karpathy 提出"Vibe Coding"时，描述的是一种近乎直觉的编程方式：用自然语言描述意图，AI 直接生成代码，开发者只需"感受"结果并不断调整。

但当你把它搬进团队协作和生产环境，问题很快浮现：代码风格混乱、边界条件遗漏、架构漂移，以及那个被反复提起的**"90 天墙"**——三个月后，代码库变成了一团没人敢动的代码。

腾讯后端团队技术负责人 rickyshou 用了三个月 Speckit 后，总结得很直接：

> "Speckit 的规范流程在企业需求的'千层套路'、海量代码面前显得理想化，上下文窗口频繁爆满让复杂任务半途而废，每次做类似需求还是要花同样的时间——因为知识全在人脑里。"

还有一个场景你一定不陌生：你花 2 小时让 AI 生成了一个完整的登录模块。代码能跑、测试能过，一切完美。然后你说"接下来做支付功能"。AI 写到一半，你发现它的异常处理方式和登录模块完全不一样——登录用了统一的 `BusinessException`，支付代码里却开始 `throw new RuntimeException`。

这不是 AI 不聪明，而是它没有持续记住整个项目的上下文。

---

## 一、当前 AI 开发中的三个核心痛点

| 痛点 | 表现 | 后果 |
| :--- | :--- | :--- |
| **上下文爆满** | 规范文档随项目增长，AI 一次性加载不全；长对话中早期决策被滚动出窗口 | 任务做到一半断片，前后代码风格不一致 |
| **知识不沉淀** | 这次做登录花 2 小时，下次做支付认证又花 2 小时；踩过的坑随对话结束而消失 | 团队能力无法积累，同样的坑反复踩 |
| **流程太死** | 流程是线性的，但企业需求是动态的；口头需求变更后 AI 直接改代码，规范文档没更新 | 文档与代码迅速脱节，规范形同虚设 |

这三个痛点指向同一个结论：**AI 开发不能只靠对话，需要一套工程化的机制来管理上下文、沉淀知识、应对变化。**

---

## 二、解法：三条铁律 + 原子任务结构

### 2.1 三条铁律

| 铁律 | 含义 |
| :--- | :--- |
| **No Spec, No Code** | 没有文档，不准写代码。AI 无约束地生成代码，试错成本远高于写几行规范 |
| **Spec is Truth** | 文档和代码冲突时，错的一定是代码。Spec 是唯一的权威来源 |
| **Reverse Sync** | 发现 Bug 或需求变更时，先修文档，再修代码 |

### 2.2 目录结构：原子任务自包含

这是整套方案的基础结构。每个 Task 是独立的原子单元，自带完整上下文：

```
项目/
├── .speccore/
│   ├── CONSTITUTION.md          # 技术宪法（始终生效）
│   ├── GLOBAL/                   # 全局需求索引
│   └── PATTERNS/                 # 模式库（踩坑经验）
│
├── 期次-Q1/                      # 迭代周期
│   ├── 00-需求文档/
│   │   └── REQUIREMENT.md        # 本迭代需求
│   ├── 01-原型/                  # HTML 原型预览
│   ├── Task-001-用户登录/        # 原子任务
│   │   ├── backend/
│   │   │   ├── REQ.md            # 功能需求
│   │   │   ├── TECH.md           # 技术方案
│   │   │   ├── TASK.md           # 任务清单 + 踩坑记录
│   │   │   └── API_CONTRACT.yaml # 接口契约
│   │   └── frontend/
│   │       └── ...               # 前端同理
│   └── Task-002-用户支付/
│       └── ...
```

**为什么有效？** AI 只需读取单个 Task 目录下的 4-5 个文件，就能拿到开发所需的全部上下文。不需要扫全局索引，不需要依赖外部记忆。多人并行开发时，每个人只关注自己的 Task 目录。

### 2.3 三个核心文件

**全局宪法 `CONSTITUTION.md`** — 技术栈、命名规范、代码规则：

```markdown
## 技术栈
- 语言: Java 17 · 框架: Spring Boot 3.2 · ORM: MyBatis-Plus 3.5

## 命名规范
- Controller: XxxController · Service: XxxService + XxxServiceImpl
- DTO: CreateXxxDTO / UpdateXxxDTO / XxxPageDTO

<!-- spec-rule: exception-handler -->
- 统一异常: 所有 Controller 抛出 BusinessException
- 全局捕获: @ControllerAdvice 统一返回 { code, message, data }
<!-- /spec-rule -->
```

**接口契约 `API_CONTRACT.yaml`** — 前后端唯一事实源：

```yaml
paths:
  /api/v1/users/login:
    post:
      summary: 用户登录
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [phone, password]
```

**原子任务 `TASK.md`** — 任务清单 + 经验沉淀：

```markdown
## AC（验收标准）
- [ ] 手机号+密码登录，返回 JWT Token
- [ ] 密码错误返回 401，不泄露用户是否存在
- [ ] 连续失败 5 次锁定 30 分钟

## ⚠️ 踩坑记录
- 坑点: 未处理 ExpiredJwtException → HTTP 500
- 解决: 全局异常处理器统一捕获 → HTTP 401
- 下次: 所有认证接口需检查 JWT 过期处理
```

### 2.4 冲突裁决

当代码与 Spec 冲突时，AI 不能"瞎猜"，按三级裁决：

| 级别 | 场景 | 处理 |
| :--- | :--- | :--- |
| L1 | Spec 明确定义，代码违反 | AI 立即修正，无需人工 |
| L2 | Spec 定义不清或自相矛盾 | AI 暂停提问，不得脑补 |
| L3 | Spec 方案不可行 | AI 升级至架构评审 |

---

## 三、在 Qcoder / Trae / Cursor / Claude Code 中落地

### 3.1 启动方式

安装后，输入 `/spec` 即可看到所有可用命令：

```bash
npm install -g speccore
speccore init                     # 在当前项目初始化
```

AI 对话中直接用自然语言触发：

| 工具 | 触发方式 |
| :--- | :--- |
| Qcoder / WorkBuddy | 输入 `/spec-execute --task=Task-001` |
| Trae | 输入 `/spec-dev` 自动检测当前阶段 |
| Cursor | 输入 `/spec-execute` 执行开发任务 |
| Claude Code / OpenCode | 输入 `/spec-analyze` 分析需求 |

> SpecCore 通过 `.codebuddy/commands/` `.qoder/commands/` `.trae/commands/` `.cursor/commands/` `.claude/commands/` 自动注入 29 个 Slash Command，`speccore init` 一次性生成，6 个工具同时可用。

### 3.2 Rules 配置（始终生效的刚性约束）

Rules 文件放入对应工具的目录即可始终生效：

| 工具 | 配置路径 |
| :--- | :--- |
| WorkBuddy | IDE 界面 → Rules → 创建 |
| Qcoder | `.qoder/commands/` |
| Trae | `.trae/commands/` |
| Cursor | `.cursor/commands/` |

> 核心宪法摘要（命名规范、异常处理、响应格式）放入 Rules 中始终生效；开发流程放入 Skills 中按需加载——兼顾 Token 效率和纪律性。

### 3.3 完整 7 步流程

```bash
speccore init           # 1. 初始化项目
speccore dev            # 2. 智能引导（自动分析+拆分）
speccore execute --all  # 3. 批量执行所有 Task
speccore pr             # 4. 提交 PR
speccore done           # 5. 完成任务
```

也可以只敲 `speccore`（无参数），自适应面板会告诉你当前该执行哪一步。

---

## 四、三大创新机制

### 4.1 反向同步（Reverse Sync）

需求变更后，传统做法是直接改代码——Spec 迅速腐烂。反向同步强制：**先修文档，再修代码。**

紧急 Hotfix 例外流程：允许 30 分钟内跳过反向同步先止血，24 小时内强制补录，图谱标记为 `⚠️ 待反向同步`，不可签署完成。

### 4.2 原子任务自包含

每个 Task 的所有 Spec（REQ + TECH + TASK + API_CONTRACT）打包在同一目录。AI 打开一个 Task，4-5 个文件就是全部上下文。不需要全局索引，不需要外部记忆。

### 4.3 模式驱动（Pattern-Driven）

传统 AI 编码：第 11 次做登录和第 1 次一样从零开始。

SpecCore：每次 Task 完成后在 `TASK.md` 记录踩坑经验，下次做类似功能时，AI 自动读取并引用——"上次登录踩了 Redis 超时的坑，这次帮你加上重试机制。"

---

## 五、设计亮点

**架构优势：**
- **三层分治**：全局 / 期次 / Task 清晰职责边界
- **API 契约锚定**：OpenAPI 3.0 YAML 作为前后端唯一事实源
- **纯 Markdown + YAML 驱动**：无运行时依赖，Git 即可版本管理
- **全员可读**：中文优先，降低沟通成本

**工程实践：**
- **Rules/Skills 分离**：宪法进 Rules（始终生效），流程进 Skills（按需加载）
- **变更履历**：每个 Spec 文件末尾自动追加变更记录
- **scaffold 骨架**：自动生成 Controller/Service/Repository 等骨架代码，开发者只需填充业务逻辑

---

## 六、命令演示

```
$ speccore
┌─────────────────────────────────────────────────┐
│  📊 SpecCore · 自适应开发面板                     │
├─────────────────────────────────────────────────┤
│  当前阶段: 需求已导入 · 下一步: 分析检查           │
│  → speccore analyze                              │
├─────────────────────────────────────────────────┤
│  进度: ████░░░░░░ 40%                             │
│  Q1/3 Tasks · 1 完成 · 1 进行中 · 1 待开始       │
└─────────────────────────────────────────────────┘

$ speccore "进度怎么样了"
📊 期次: Q1
  ✅ Task-001 用户登录    已完成
  🔄 Task-002 支付模块     进行中
  ⏳ Task-003 订单管理     待开始

$ speccore "分析一下当前的宪法有没有问题"  
🔍 宪法检查完成
  ✅ 6/7 规则有覆盖
  ⚠️  缺少: 数据库事务处理规则
  💡  建议: 在 CONSTITUTION.md 添加 spec-rule: transaction
```

---

## 七、总结：一套方案，三个答案

| 问题 | 答案 |
| :--- | :--- |
| 如何让 AI 不"失忆"？ | 原子任务自包含——AI 只需读当前 Task 下 4-5 个文件 |
| 如何让知识不消失？ | PATTERNS 模式库持续沉淀，每次开发都是团队的积累 |
| 如何让前后端 AI 不打架？ | API 契约锚定，各司其职，并行开发 |

这套方案不是最重的，也不是最轻的，而是在**团队协作性、知识复用性和流程灵活性**之间找到了最佳平衡点的生产级 AI 研发基座。

核心理念只有一句：**让 AI 在正确的时刻拿到正确的信息，让知识持续沉淀、持续复用。**

---

> 开源地址：[GitHub](https://github.com/windfallsheng/SpecCore-ts) · [Gitee](https://gitee.com/windfullsheng/spec-core-ts)  
> 项目持续演进中，欢迎交流实践经验和改进建议。

---

*相关资源：*
- [腾讯技术工程：认知重建——Speckit 用了三个月，我放弃了](https://km.woa.com)
- [AI 原生研发范式：从"代码中心"到"文档驱动"的演进](https://github.com/Fission-AI/OpenSpec)
- [OpenSpec - 规范驱动开发工具](https://github.com/Fission-AI/OpenSpec)
- [Spec Kit - GitHub 官方仓库](https://github.com/github/spec-kit)
