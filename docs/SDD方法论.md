# SDD 规范驱动开发方法论

> Spec-Driven Development — 以规范为锚点，让 AI 稳定输出。

---

## 一、什么是 SDD

SDD（Spec-Driven Development，规范驱动开发）是一套面向 AI 原生团队的研发方法论。核心理念：

**每一行代码都有对应的一行 Spec，AI 在 Spec 的约束下工作。**

传统 TDD 是"先写测试、再写代码"；SDD 是"先写 Spec、AI 理解和执行 Spec、再验证产出是否符合 Spec"。

---

## 二、为什么需要 SDD

### 2.1 AI 编程的四大痛点

| 痛点 | 描述 | SDD 如何解决 |
| :--- | :--- | :--- |
| **上下文遗忘** | AI 执行到第 15 个任务时忘了第 1 个任务的架构约束 | 每批次执行前重读 Spec（分批 + 上下文隔离） |
| **代码风格不一致** | 同样的功能，不同会话生成出不同风格的代码 | CONSTITUTION.md 定义技术宪法，全局约束 |
| **需求追溯断裂** | 代码改了，但不知道对应哪个需求 | Req → Task → Code 双向追溯链 |
| **Token 浪费** | AI 花费大量 Token 在目录创建、文件读写上 | CLI 执行确定性操作，AI 只做智能决策 |

### 2.2 核心架构：确定性逻辑与智能逻辑解耦

```
用户输入（自然语言 / Slash Command）
        │
        ▼
┌───────────────────────────────────────┐
│   AI 层（智能决策）                     │  ← AI 工具 (WorkBuddy / Cursor / Claude)
│   - 理解用户意图                       │
│   - 决定执行哪些操作                   │
│   - 生成代码内容                       │
└───────────────────────────────────────┘
        │ 调用 CLI 命令
        ▼
┌───────────────────────────────────────┐
│   CLI 层（确定性执行）                  │  ← Speccore CLI
│   - 创建目录结构                       │
│   - 读写配置和 Spec 文件               │
│   - 解析 YAML                          │
│   - 合规校验                           │
│   - 事务保护（失败自动回滚）            │
└───────────────────────────────────────┘
```

**效果**：AI Token 消耗降低 50%+，文件操作成功率 100%（由代码保障）。

---

## 三、SDD vs TDD vs BDD

| 维度 | TDD | BDD | SDD |
| :--- | :--- | :--- | :--- |
| **核心产物** | 测试用例 | 行为场景 | 规范文档（Spec） |
| **驱动方** | 开发者 | 产品/测试 | AI + 开发者 |
| **验证目标** | 代码正确性 | 业务行为正确性 | 需求完整性 + 代码正确性 |
| **AI 兼容性** | 中（测试可自动生成） | 低（场景需人工编写） | 高（Spec 即 AI 指令） |
| **适用阶段** | 编码 | 需求定义 | 全流程（需求→设计→编码→验证） |

SDD 不是替代 TDD，而是**前置 TDD**：在写测试之前，先确保 AI 和人对需求的理解一致。

---

## 四、SDD 的五个核心实践

### 4.1 Spec 优先

开发任何功能前，先创建 Spec 文档（REQ.md + TECH.md + TASK.md + API_CONTRACT.yaml）。Spec 是 AI 的指令集，不是"额外的文档负担"。

### 4.2 命令驱动

通过 CLI 命令操作项目结构和 Spec 文件，而非手动创建目录、编辑 YAML、维护表格：

```bash
speccore init                           # 项目初始化（一键创建完整结构）
speccore new-task --platforms=web,h5   # 创建多平台任务（自动生成 Spec 骨架）
speccore execute --all --batch-size=3  # 分批执行（上下文隔离）
speccore validate                      # 合规校验（自动检测 Spec 完整性）
```

### 4.3 事务保护

所有写操作都有事务保护，失败自动回滚。不存在"改了一半卡住"的情况。

### 4.4 双向追溯

需求 → 期次 → Task → 代码，完整关联链路。每一行代码都能追溯到具体的需求节点。

```bash
speccore impact --req=REQ-001    # 查看需求影响范围
speccore context --task=Task-001 # 查看任务上下文和依赖
```

### 4.5 规范与代码分离

Spec 作为独立仓库管理，代码工程平级部署。权限清晰、版本独立、多工程共享同一份 Spec。

---

## 五、SDD 的工作流

```
1. 需求分析
   └→ 创建期次: speccore iteration create
   └→ 编写 REQ.md（需求描述）

2. 任务拆分
   └→ 创建 Task: speccore new-task --platforms=web,h5
   └→ 完善 TECH.md / TASK.md / API_CONTRACT.yaml

3. 执行开发
   └→ AI 读取 Spec → 生成代码
   └→ speccore execute --all --batch-size=3

4. 验证闭环
   └→ speccore validate（合规检查）
   └→ speccore sync --reverse（代码回写 Spec）

5. 归档沉淀
   └→ speccore archive --all
   └→ speccore backup（状态备份）
```

---

## 六、适用场景

| 场景 | 推荐度 | 说明 |
| :--- | :--- | :--- |
| AI 辅助编程团队 | ⭐⭐⭐ | SDD 天然适合 AI 工具 |
| 多端并行开发 | ⭐⭐⭐ | 多平台 Task 统一管理 |
| 需求频繁变更 | ⭐⭐⭐ | 变更影响一键分析 |
| 新手项目 | ⭐⭐ | Spec 是天然文档 |
| 单人小项目 | ⭐⭐ | CLI 自动化减少机械操作 |

---

## 七、与其他方法论的结合

- **SDD + TDD**：Spec 定义"做什么"、测试验证"做得对不对"——互补关系
- **SDD + DDD**：限界上下文映射到 SpecCore 的项目维度、聚合根映射到 Task——协同关系
- **SDD + CI/CD**：`speccore validate` 作为 CI 检查项、Git Hooks 自动化——集成关系

---

## 八、一句话总结

**SDD = 用 Spec 驱动 AI、用 CLI 保证确定性、用事务保护数据。**
