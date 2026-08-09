# MCP scheduled_tasks 方案分析

> 日期: 2026-08-08 | 版本: v5.67.30
> 目的: 对比现有 daemon 方案与 MCP Sampling 方案，确定 SpecCore 调度能力的升级路径。

> 💡 **命令类型**: 本文档中的 `speccore execute` 为 🔒 AI 命令，需在 AI IDE 中通过 `@spec-ask` 使用。

---

## 一、现有方案: speccore schedule daemon

### 架构

```
speccore schedule create → 写入 .speccore/local/schedule.json
speccore schedule daemon start → spawn 子进程，每 30s 轮询
到点 → spawnSync("speccore", ["execute", "--auto", "--force"])
```

### 硬伤

| 问题 | 根因 |
|:---|:---|
| **无法调 AI** | daemon 是纯 CLI 进程，`execute` 需要 AI 读 `[SPECCORE_PROMPT]` 生成代码，spawnSync 跑不了这个交互 |
| **无状态反馈** | 任务过期了、AI 不在线了，daemon 只能在 stdout 打印错误，无法通知用户 |
| **跨平台脆弱** | LaunchAgent (macOS)、systemd (Linux)、计划任务 (Windows) 各一套，维护成本高 |
| **无法暂停/恢复** | 虽然 store 支持，但 daemon 不会感知 |
| **与 IDE 无关** | 纯 OS 进程，IDE 重启/挂起时状态丢失 |

### 适合场景

- 纯 CLI 操作（git 备份、日志清理、数据迁移）
- 不涉及 AI 代码生成的定时任务

---

## 二、MCP 方案: schedule-task-mcp

### 架构

```
AI 调用 MCP create_task
   { trigger: "cron 0 2 * * *", agent_prompt: "执行 Q1 所有待开发任务" }
   ↓
MCP Server 注册到 SQLite，启动 internal timer
   ↓
到时间 → MCP Server 调用 sampling/createMessage
   → 宿主 AI 被唤醒
   → AI 执行 agent_prompt（完整的工具权限）
   → 返回结果 → MCP Server 记录
```

### 优势

| 能力 | daemon 方案 | MCP 方案 |
|:---|:---|:---|
| 调用 AI 生成代码 | ❌ 不可能 | ✅ MCP Sampling 唤醒 AI |
| 跨平台 | ❌ 三套实现 | ✅ 标准 MCP 协议 |
| 持久化 | 简单 JSON | ✅ SQLite，有运行历史 |
| 暂停/恢复 | ⚠️ 实现但 daemon 不感知 | ✅ MCP 工具 |
| 时区处理 | ⚠️ 手动 | ✅ 环境变量配置 |
| 自然语言创建 | ⚠️ 通过 ask 引擎 | ✅ 直接 support |
| 失败重试 | ❌ 没有 | ✅ 待验证 |
| 与 IDE 解耦 | ❌ | ✅ MCP 协议层 |

### Sampling 机制详解

```
┌─────────────┐     triggered      ┌──────────────────┐
│ MCP Server   │ ──────────────────→│ Host IDE/AI Agent │
│ (schedule)   │   sampling/        │                    │
│              │   createMessage    │ 执行 agent_prompt   │
│              │ ←──────────────────│                    │
│              │   响应文本          └──────────────────┘
└─────────────┘
```

- `agent_prompt` 可以是自然语言，例如:
  - `"对 Iteration-Q1 中所有 pending 状态的任务执行 speccore execute"`  
  - `"检查 .speccore/ITERATIONS/Iteration-Q1/Task-001/TASK.md 状态，如果 COMPLETED，更新 context.json"`
- AI 被唤醒后拥有完整的工具权限（Bash、Read、Write、Edit）
- 超时时间可配置（默认 3 分钟）

### 风险/不足

| 风险 | 说明 |
|:---|:---|
| **依赖 MCP 连接** | 宿主 AI 必须在运行且有 MCP 连接 |
| **Sampling 不稳定** | 新特性，部分 MCP 客户端可能不支持 |
| **单点故障** | MCP Server crash 后所有调度丢失（SQLite 可恢复） |
| **并发限制** | 同时只能有一个 sampling 请求，大量到期任务需排队 |

---

## 三、方案对比

| 维度 | keep daemon | 迁移到 MCP | 双轨（推荐） |
|:---|:---|:---|:---|
| 纯 CLI 任务 | ✅ | ⚠️ 不必要的开销 | ✅ daemon |
| AI 代码生成 | ❌ | ✅ Sampling 唤醒 | ✅ MCP |
| 实现工作量 | 0 | 中（需要对接 MCP 协议） | 小（daemon 保留，新增 MCP 通道） |
| 维护成本 | 低 | 低（第三方维护） | 中 |
| 用户体验 | ❌ 定时任务静默失败 | ✅ 到点 AI 自动响应 | ✅ 各取所需 |
| 迁移风险 | 无 | 高（替换旧方案） | 低（并行运行） |

---

## 四、推荐路径: 双轨并行

### 第一阶段: 保留 daemon + 接入 MCP

1. **daemon 保留不动** → 继续服务纯 CLI 调度（备份、同步、迁移）
2. **新增 MCP 通道** → `speccore schedule create --mcp` 创建 MCP 任务
3. **AI 开发任务** → 统一走 MCP，依赖 Sampling 唤醒 AI

### 第二阶段: 渐进替换（可选）

当 MCP 方案稳定后:
- `speccore schedule daemon start` → 自动切换到 MCP
- 旧 daemon 进程保持兼容但不再推荐

### 技术细节

#### 1. WorkBuddy MCP 配置

```json
{
  "mcpServers": {
    "schedule-task-mcp": {
      "command": "npx",
      "args": ["-y", "schedule-task-mcp"],
      "env": {
        "SCHEDULE_TASK_TIMEZONE": "Asia/Shanghai",
        "SCHEDULE_TASK_DB_PATH": "~/.speccore/schedule.db",
        "SCHEDULE_TASK_SAMPLING_TIMEOUT": "600000"
      }
    }
  }
}
```

#### 2. speccore schedule 命令改造

```
speccore schedule create --mcp \
  --at "2026-08-09 02:00" \
  --agent-prompt "执行 Iteration-Q1 所有待开发任务，生成代码并更新 TASK.md"
```

CLI 内部调用:
```typescript
// 方案 A: 直接通过 MCP SDK 调用
mcpClient.callTool('schedule-task-mcp', 'create_task', {
  name: 'Q1-nightly-build',
  trigger_type: 'date',
  trigger_config: { run_date: '2026-08-09T02:00:00+08:00' },
  agent_prompt: '执行 Iteration-Q1 所有待开发任务...'
});

// 方案 B: 输出 JSON，让宿主 AI 调用
process.stdout.write(`[SPECCORE_MCP_SCHEDULE: ${JSON.stringify(taskConfig)}]\n`);
```

推荐 **方案 B** — 不依赖 MCP SDK，通过标签让宿主 AI 调用，保持与现有 SPECCORE 标签体系一致。

#### 3. 标签体系扩展

新增标签:
```
[SPECCORE_MCP_SCHEDULE: {json}]  → AI 调用 mcp__schedule-task-mcp__create_task
```

AI 处理流程:
```
speccore ask 输出 [SPECCORE_MCP_SCHEDULE: {...}]
  → AI 读取 JSON
  → DeferExecuteTool("mcp__schedule-task-mcp__create_task", params)
  → MCP 注册任务
  → 到点 AI 被唤醒执行
```

---

## 五、结论

**不建议替换 daemon**。MCP 方案解决的是 daemon 无法调 AI 的硬伤，但 daemon 对纯 CLI 任务仍是最高效的方案。

**建议双轨并行**:
- daemon → 纯 CLI 定时任务
- MCP → 需要 AI 参与的开发任务、分析、代码生成

优先级: MCP 通道（新功能）> daemon 优化（现在能跑就行）。

---

## 六、下一步

1. 先验证 WorkBuddy 是否支持 MCP Sampling
2. 安装 schedule-task-mcp 试跑一次
3. 确认 sampling/createMessage 响应延迟是否符合要求
4. 在 speccore ask 引擎中新增 `[SPECCORE_MCP_SCHEDULE]` 标签
5. 升级 `schedule create` 命令支持 `--mcp` 模式
