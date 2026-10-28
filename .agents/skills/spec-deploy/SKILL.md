---
name: spec-deploy
description: >
  部署专属 Skill。覆盖 build / deploy / pipeline 命令的意图识别与参数提取（由引擎执行）。
  支持自然语言（"部署到测试环境"）和显式参数（--env test --all）。
  参数缺失时引擎输出 [SPECCORE_NEEDS_INFO] 交互式提示；前置校验（环境配置与平台有效性）由引擎执行。
  支持 Pipeline 内置测试节点（--test-enabled）和分层测试策略。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。

## 实时配置纪律（每次发起必读，最高优先级）

用户可能在上次部署后临时改过配置（branch / 打包命令 / 部署目标 / host），
每次发起部署前必须当场 Read 最新配置，禁止依赖记忆或上一次读取的结果：

- Read `.speccore/PROJECT.yaml`（端列表、code_path、default_branch）
- Read `.speccore/environments/{env}.yaml`（branch / build_cmd / deploy 目标）
- 以本次 Read 到的内容为准，不凭印象或旧会话记忆回答「拉哪个分支、打什么包、部署到哪」

CLI 本身无缓存（deploy/build/pipeline 每次 readFile 直读磁盘），纪律在 AI 侧：先 Read 再执行。

## 过程可视化（v8.3.348+，CLI 已内置）

- 部署前：CLI 打印「部署计划」面板（每个端 → 分支及来源 → 构建命令 → 部署目标）
- 执行中：git checkout / pull 的实际输出透明透出（拉了什么分支、结果如何）
- 结束后：汇总报告含每个端的实际分支列
- 向用户汇报时直接引用这些输出：操作了哪个端、拉了什么分支、打包命令、结果

## 备份开关（v8.3.348+）

三层控制，优先级从高到低：

1. **端级排除** `--skip-backup-for h5-mobile,order-api`：本次这些端不备份（其余按下面两层走）
2. **全局开关** `--backup` / `--no-backup`：全部端统一开启/关闭
3. **配置字段** `deploy.{env}.backup` / `backup_keep`：每个端各自的默认值

ask 自然语言识别：「部署到测试环境，h5-mobile 不备份」→ `--skip-backup-for h5-mobile`；
「部署到测试环境并备份，order-api 和 sr-web 不备份」→ `--backup --skip-backup-for order-api,sr-web`。
仅 ssh / docker 类型支持（sftp 无远端 shell 权限），计划面板会显示每个端的备份状态。

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步请在同一会话继续执行提示中的命令；上下文紧张时才开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 优先在同一会话继续下一批（按标记中的命令执行）；上下文紧张时开新对话，先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
