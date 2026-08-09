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
speccore init Meeting-System --stack spring-boot3+vue3

# 2. 创建第一个迭代
speccore iteration init -n "meeting-system"

# 3. 分析需求
speccore analyze -i meeting-system --prompt "分析会议室管理系统的完整需求"

# 4. 创建开发任务
speccore task new -i meeting-system --topic room-service
speccore task new -i meeting-system --topic booking-service
speccore task new -i meeting-system --topic admin-dashboard
speccore task new -i meeting-system --topic h5-mobile

# 5. 执行任务
speccore execute -i meeting-system -t Task-001-room-service --prompt "开发会议室服务"
```

## SpecCore 常用命令

| 命令 | 说明 |
|------|------|
| `speccore ask '<用户原话>'` | 意图入口，所有需求走这里 |
| `speccore init <项目名>` | 初始化项目 |
| `speccore iteration init -n <短名>` | 创建迭代 |
| `speccore analyze -i <迭代> --prompt '<描述>'` | 分析需求 |
| `speccore plan -i <迭代> --prompt '<描述>'` | 制定计划 |
| `speccore execute -i <迭代> -t <任务> --prompt '<描述>'` | 执行任务 |
| `speccore dashboard` | 查看进度面板 |
| `speccore context --set` | 切换上下文 |

## 自动模式说明

### 半自动模式（默认）
逐个执行任务，每个任务需要用户确认，适合开发过程需人工审阅的场景。

```bash
speccore execute -i meeting-system -t Task-001-room-service --prompt "开发会议室 CRUD 服务"
```

### 全自动模式
自动执行迭代中的所有任务，无需逐个确认。

```bash
speccore execute -i meeting-system --auto --prompt "全自动执行所有开发任务"
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
