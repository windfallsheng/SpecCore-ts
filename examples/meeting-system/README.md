# Meeting System — 会议室管理系统

多端会议室管理系统，支持后台管理端（Web 管理面板）、后台服务端（REST API）、H5 移动端（手机浏览器），实现会议室资源管理、会议预订、通知推送等核心功能。

## 项目结构

```
meeting-system/
├── README.md                          # 项目说明
├── AGENTS.md                          # SpecCore 规则文件
├── .speccore/
│   ├── CONSTITUTION.md                # 项目宪章
│   ├── local/
│   │   └── context.json               # 本地上下文
│   └── ITERATIONS/
│       └── Iteration-001-meeting-system/
│           ├── 000-overview/          # 概览文档
│           ├── 010-requirements/      # 需求阶段产出
│           ├── 020-specs/             # 规格分析阶段产出
│           ├── 030-tasks/             # 任务分解阶段产出
│           └── STAFFING.md            # 人员分工
```

## 快速开始

```bash
# 1. 初始化项目
speccore init

# 2. 创建第一个迭代
speccore iteration create -n Q1 --topic meeting-system --owner luzhaosheng

# 3. 创建开发任务（CLI 命令）
speccore task new -n "会议室服务" --topic room-service -i meeting-system -t feature
speccore task new -n "预订服务" --topic booking-service -i meeting-system -t feature
speccore task new -n "后台管理" --topic admin-dashboard -i meeting-system -t feature
speccore task new -n "H5移动端" --topic h5-mobile -i meeting-system -t feature

# 4. 分析+开发（在 AI IDE 中使用）
@spec-ask "分析 meeting-system 的需求，自动执行分析+计划，执行前确认"
```

## SpecCore 常用命令

| 命令 | 说明 | 类型 |
|------|------|------|
| `speccore init <项目名>` | 初始化项目 | CLI |
| `speccore iteration create -n <短名>` | 创建迭代 | CLI |
| `speccore task new -n <名称>` | 创建开发任务 | CLI |
| `@spec-ask "..."` | AI 语义入口（IDE 中使用） | 🔒 AI |
| `@spec-ask "分析需求"` | 分析需求 | 🔒 AI |
| `@spec-ask "制定执行计划"` | 制定计划 | 🔒 AI |
| `@spec-ask "执行任务"` | 执行任务 | 🔒 AI |
| `speccore dashboard` | 查看进度面板 | CLI |
| `speccore context --set` | 切换上下文 | CLI |

## 自动模式说明

### 半自动模式（默认）
逐个执行任务，每个任务需要用户确认，适合开发过程需人工审阅的场景。

```bash
# 半自动执行（在 AI IDE 中使用 @spec-ask）
@spec-ask "分析+计划自动，开发前确认 -i meeting-system"
```

### 全自动模式
自动执行所有任务，无需逐个确认。

```bash
# 全自动执行（在 AI IDE 中使用 @spec-ask）
@spec-ask "全自动执行所有任务 -i meeting-system"
```

## 技术栈

### 后台服务端
- Java 17 + Spring Boot 3.3
- Spring Security + JWT 认证
- MyBatis-Plus 3.5 + MySQL 8.0
- Redis 7.0（缓存/分布式锁）
- RabbitMQ（消息队列）

### 后台管理端
- Vue 3.4 + TypeScript + Element Plus
- Vite 5 构建工具
- Pinia 状态管理
- Axios HTTP 客户端

### H5 移动端
- Vue 3.4 + Vant 4
- Vite 5 构建工具
- Pinia 状态管理
