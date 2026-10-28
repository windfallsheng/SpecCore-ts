# Changelog

## v8.3.348 (2026-10-28) — 部署链路过程可视化：计划面板 + 自动分支解析 + 实时配置读取

回答「部署哪个环境、哪些端，拉哪个分支、打什么包、部署到哪、结果如何」全程可见：

- **部署计划面板**：deploy 执行前打印每个端的完整计划——目标分支（含来源）→ 构建命令 → 部署目标，dry-run / skip-build 状态一并标注。
- **自动分支解析（四级回退）**：deploy 默认不再拿工作区当前代码构建，而是按「环境平台级 branch → 环境全局 branch → PROJECT.yaml default_branch → 子任务 git-config 源分支」解析目标分支并 checkout + pull；显式 --branch 优先。新增公共模块 src/core/deploy/branch-resolver.ts，pipeline 复用同一解析逻辑。
- **git 操作透明化**：checkout / pull / merge 的实际输出直接透出（拉了什么、冲突原因），不再静默 pipe。
- **汇总报告加分支列**：deploy 与 pipeline 的执行汇总都显示每个端实际使用的分支。
- **每次发起实时读配置**：部署发起时当场重读 PROJECT.yaml 与 environments/{env}.yaml（全链路无缓存），用户临时改 branch / 打包命令 / 部署目标当次生效；不传 --env 时也默认加载 staging 环境配置（此前会跳过合并）；spec-deploy 技能同步写入「先 Read 再执行」纪律。
- **远端旧包备份开关**：ssh 部署 SCP 覆盖前远端 tar 备份、docker 远程部署 pull 前旧镜像打 backup tag（tag 零成本），保留份数 backup_keep（默认 5）自动清理最旧备份；四层控制——配置字段 backup/backup_keep + CLI 全局 --backup/--no-backup + CLI 端级排除 --skip-backup-for h5-mobile,order-api + ask 自然语言（「部署并备份」/「不备份部署」/「部署到测试环境，h5-mobile 不备份」→ 端级排除），计划面板逐端显示备份状态。sftp 无远端 shell 权限暂不支持（待后续版本）。
- **ask 部署句路由修正**：「部署到 X 环境」此前被误路由到 run --preset deploy 流水线（意图缓存还会固化误判），现确定性路由至 deploy 单命令；「测试环境」中的「测试」不再被误判为测试动作。
- **pr --auto 死参数修复**：run 流水线 pr 步骤传的 --auto 此前未在 CLI 注册，参数被静默吞掉后退化成交互式等待；现展开为 --force + --create-pr（非交互自动提交并建 PR）。
- **pipeline 备份开关透传**：pipeline 注册 --backup / --no-backup / --skip-backup-for 并透传给内部 deploy 步骤（与 deploy 单命令同语义、同优先级）。
- **示例修正**：deploy-examples.yaml 环境配置段更新为新结构（env / defaults / platforms.{端}.branch），补四级回退、计划面板与 backup 字段说明。

## v8.3.347 (2026-10-28) — 项目名片按需注入：模糊端名 → 项目信息映射

用户用自然语言提到某个端（端名/业务名/类型词），AI 不再需要用户反复说明「项目是什么、代码在哪」：

- **三级匹配，多端并行命中**：端名（词边界 + 复合名分段，H5端 → h5-mobile）+ 业务名模糊命中 + 类型词（「前端」→ 全部 frontend 端）。一句话提 N 端注入 N 张小名片，未提项目零注入。
- **模糊层**：归一化容差（大小写/空格/连字符）+ 中文滑窗——「预订」→ 预订服务、「后台」→ 管理后台；3 字段需完整出现，防「移动」「程序」等泛词误命中。
- **置信度分级**：端名/全量/类型词 = 确定（直接注入）；滑窗部分提及 = ⚠️疑似标注 + 引导核实——猜测与确定信息不混在一起。
- **四层提示体系**：AGENTS.md「项目速查」区（每端一行常驻指针）+ ask 命中注入 + 疑似标注 + 全量名片落盘 `.speccore/GLOBAL/PROJECTS.md`（数据源 PROJECT.yaml platforms 段，AI 按需 Read）。
- **文档体检同步**：命令面收敛后全量文档体检——clarify/synthesize/status-panel 残留引用、幽灵 slash 命令（/spec-progress、/spec-task-new 等）、workspace-organization 仓库名排版断裂、run split 示例统一为 split-units。

## v8.3.346 (2026-10-26) — 命令面收敛：help 面板 51 → 22 核心命令

`speccore --help` 此前把全部 51 个命令裸列在核心盒子之下，「60 多个命令」劝退新用户。本次收敛为三层：

- **对外展示 22 个核心命令**：流水线 13 阶段（init → doc2spec → req-doc → unitize → analyze → taskify → plan → execute → verify → pipeline → pr → done → spec2doc）+ 基础管理（iteration/task）+ 智能入口（ask/run/next/dashboard/status/about/help）。
- **隐藏 29 个命令但功能保留**：低频/运维/内部编排命令（doctor/migrate/change/validate/global/search 等）从 help 面板隐藏——ask 引擎意图词典、run 流水线编排、内部逻辑调用仍直接可用，直接输入命令照常执行。隐藏 ≠ 删除。
- **全量清单入口**：新增 `speccore help --all`，分「⭐ 核心命令 / 🔧 更多命令」两段展示全部命令；`speccore help` 默认分类视图同步收敛为 6 类核心命令，并补齐 doc2spec/verify/pipeline/spec2doc 等 9 个缺失的命令详情。
- **单一事实源**：新增 `src/core/command-visibility.ts`（CORE_COMMANDS 名单），cli.ts 隐藏遍历与 help.ts 全量视图共同消费，增删命令只改一处；实现基于 commander 11 的 `hidden` 选项（visibleCommands 自动过滤），零功能损失。
- **核心盒子同步**：help-panel.ts 顶部盒子更新为完整 13 阶段流水线行，删去已隐藏的 change/validate/rename/prompts，补 verify/pipeline/req-doc/status，底部加 `help --all` 提示。
- **文档同步**：README 中英两版「完整命令（分类）」收敛为 22 核心命令表（删「60 个命令」文案）；静态模板 templates/html/speccore-help.html 清理幽灵命令（code-index/history/knowledge/refresh/track）并重写为 6 类核心命令 + help --all 提示；docs/command-reference.md 与 docs/commands.en.md 补充面板收敛说明。

## v8.3.345 (2026-10-26) — FUNCTION_MAP 单元ID 新表头兼容

修复「功能单元名解析错位」断链：analyze 落盘 FUNCTION_MAP 的表头已演进为「| 单元ID | 功能模块/功能单元 | 中文名 | 涉及端 | 优先级 |」（首列是 M-01 这类单元ID），但 parseFunctionMapTable 仍取首列作单元名——解析出 name='M-01' 而非目录名，导致 taskify 三处下游受害：模块驱动拆分任务名/slug 全变成 m-01、extractOverviewContext 关键词拆分后为空（功能单元上下文全部丢失）、功能点覆盖校验误报遗漏。

- **名称列表头定位**：parseFunctionMapTable 新增 nameColIdx——按表头含「功能模块/功能单元」且非「涉及端」的列定位单元名（新格式取第 2 列、旧格式取第 1 列均正确）；无表头信息时兜底——首列若为单元ID 模式（M-01/F-01）取第二列，否则取首列（旧数据「| 目录名 | 名称 | …」）。
- **触发条件扩展**：表格与原始行解析的 inTable 触发从「功能单元」扩展到「功能单元/功能模块」双表头，analyze 汇总模板（「功能模块」表头）也能触发检测与解析。
- **检测不受影响确认**：detectNarrowPlatformDeclarations 锚定用「与功能单元目录名精确相等」的任意单元格，与名称列定位解耦，未受影响；会议项目真实数据端到端 gaps=0 验证通过。

## v8.3.344 (2026-10-26) — 迭代素材资产注入（原型 HTML + 参考截图/设计稿）

补齐「素材目录无通道」盲区：此前只有「被已加载文档以 Markdown 链接引用」的资产会进入上下文（processMarkdownContent 展开文档内链接/图片），而 010-requirements/prototypes/ 与 assets/（extracted/prototypes/designs/screenshots）下未被引用的原型 HTML、参考截图、设计稿完全无通道——execute 生成代码时看不到原型、analyze 产出 UI_SPEC 时看不到设计稿。

- **collectIterationMediaAssets**：buildPrompt 在 execute/analyze 且指定迭代时扫描素材目录（递归限深度），HTML 原型走 renderHtmlPrototype 渲染 ARIA 语义树 + 截图路径（多模态宿主可直看），渲染失败降级 extractHtmlText；图片走视觉模型描述（前 3 张）或路径+大小清单（最多 10 张）。限额防撑爆上下文，无素材静默返回 null，扫描失败不阻断。
- **analyze rawPrompt 路由衔接**：rawPrompt 路由会丢弃常规 extraSpecs，素材资产与阅读清单一并随路由追加，保证 analyze 阶段（UI_SPEC 生成）也能看到视觉素材。
- **资产审计一致**：素材注入全部走 recordAssetAudit，断链/降级在审计清单可见，不再静默丢失。

## v8.3.343 (2026-10-23) — FUNCTION_MAP 端覆盖交叉校验（声明过窄检测）

修复「切分层声明的端 ≠ 分析层落实的端」断链：doc2spec 写进 _matrix.md 的 platforms 语义是「端级需求文档归属端」（常单端），而 analyze 阶段 AI 写入 FUNCTION_MAP 的端覆盖语义是「功能单元跨端协作涉及端」（多端）——两者被同一字段承载却无交叉校验，骨架按单端声明收敛后，多端单元的后端端级规格大面积缺失，taskify 拿不到后端规格（瞎编/漏任务）、execute 时代码生成不完整。

- **声明过窄检测**：新增 `src/core/function-map.ts`，analyze 骨架检测完成后比对 FUNCTION_MAP 端覆盖与 _matrix 声明（以「与功能单元目录名精确相等的单元格」锚定行 + 端列自适应定位），分两类缺口警告——①missing：FUNCTION_MAP 有、_matrix 无、端目录无真实规格 → 提示补端分析；②undeclared：端级规格已存在但 _matrix 未声明 → 提示同步声明（taskify 的 readMatrixPlatforms 非空即采信，声明不更新则多端子任务依然不会生成）。只告警不回灌，避免 AI 生成的 FUNCTION_MAP 污染权威声明。
- **FUNCTION_MAP 解析收敛**：parseFunctionMap（表格+树形双格式、端列自适应容错）从 taskify.ts 迁至 function-map.ts，analyze 检测与 taskify 拆分共用同一解析器，消除双份实现漂移。
- **DOC_MATRIX 顶层校验修正**：feature 项目的平台文档校验跳过 020-specs/{端}/ 顶层旧架构路径（已由 computeFeatureBasedAnalyzeManifest 按 {feature}/{端}/ 覆盖），修复此前误建顶层骨架文件的问题。

## v8.3.342 (2026-10-22) — HTML 页面家族联动

修复「命令弹出页面但页面不存在/页面内跳转目标缺失」的断链：welcome 项目名片跳 ask 引导页/配置指南/帮助页，但此前只有 ask/init/help 各自跑过才会生成目标页，且 welcome 的 TTY 分支输出 [SPECCORE_WELCOME] 标记却不写文件——宿主 AI 拿到标记打开不存在的页面。新增 `src/core/page-bundle.ts` 页面家族联动模块，幂等补齐跳转目标；welcome/ask/init 三个入口统一接入。

- **页面家族联动模块**：`ensureAskPages`（onboarding + 四模式页 + 帮助页 + 提示词库）、`ensureSetupGuidePage`（配置引导页 + 提示词库）、`ensureWelcomeTargets`（名片全部跳转目标），均幂等可重复调用、失败不阻断主流程；对 ask.ts 采用运行时动态 import 避免循环依赖。
- **welcome 断链修复**：AI 分支与 TTY 三个分支统一先落盘名片并联动补齐家族，再输出标记——修复此前 TTY 分支「标记在文件不在」的 bug；阶段/任务数计算上提为函数级共用。
- **ask/init 收编**：ask 首次/升级仪式改为调用 ensureAskPages（原有复制+prompts 联动逻辑收敛到一处）；init 的 writeSetupGuide 复用 ensureSetupGuidePage。

## v8.3.341 (2026-10-21) — 工程健康度优化 + 命令盘点精简

两大主题：①全项目体检后按性价比落地的四项改进——deploy 引擎 execSync 模板拼接改为 execFileSync 参数数组（带安全属性的唯一项，杜绝「配置即命令」注入面）、分支类型提取与环境目录定位收敛为共享导出、三个核心引擎纯函数导出并补切片测试、analyze.ts 巨函数渐进拆分（8 个模式早退块 476 行抽出为模块级函数）；②命令盘点精简——移除 20 个边缘命令（流水线核心命令、进度导出与 welcome/help/about 等友好命令保留），全部提及点（help/ask 词典/补全/README/docs/IDE slash/运行时提示/模板预设）同步清理，索引维护统一入口收敛为 reindex。行为零变化，全量 621/621 通过。

### deploy 引擎参数数组化（v8.3.341+）

`src/core/deploy/engine.ts` 中 11 处不带 shell 语义的命令执行从 execSync 模板拼接改为 execFileSync 参数数组（新增 runFile 包装）：aws s3 sync、rsync、vercel、kubectl、scp/ssh、helm、pm2、serverless（阿里云 FC / AWS Lambda / 腾讯云 SCF）等。配置值作为独立参数传递，不经过 shell 解释——此前 target/host/namespace 等配置项理论上可注入 shell 元字符。三处语义保留：`cd X && cmd` 等价变换为 `cwd=X` 参数数组；`scp ${outputDir}/*` 的通配符依赖本地 shell 展开，改用 glob 包显式展开；sshpass 密码改独立参数传递（不再经过引号拼接）。用户显式书写的 shell 命令（build_cmd/script/pre_deploy）、命令存在性探测（sshpass -V）与管道语义保留 execSync。

### 公共工具层收敛（v8.3.341+）

- **extractBranchTypeFromBranchName**：从 pr.ts 提升至 git-integration 统一导出（纯函数、可测试），pr.ts 复用；非任务分支（无类型段）返回 undefined。
- **envDirFor**：environment-config 新增带参导出（指定项目根），update-env-configs 的 initEnvironmentConfigs 改用，路径拼接段只写一处。

### 核心引擎纯函数导出 + 切片测试（v8.3.341+）

此前零直接测试的三个核心引擎补上切片测试（18 个新用例）：

- **structured-extractor**：isTsOrJs / detectLanguage / inferPlatform 导出，测试 TS/JS 系扩展名（含 mts/cts）、Java/Python/Go 语言判定、路径→平台归属。
- **prompt-builder**：extractInfoGaps（INFO_GAP 提取与去重）与 parseAiResponse（AI 响应 JSON 解析）导出并测试——二者是 AI 接力协议的关键解析器。
- **extractBranchTypeFromBranchName**：任务分支提取类型段、非任务分支返回 undefined、空白分支名容错。

### analyze.ts 巨函数渐进拆分（v8.3.341+）

analyzeCommand（原 2570 行）由「模式早退分支」构成，本次将 8 个零数据流依赖的块整抽为模块级函数：analyzeFromCode / analyzeAuditFix / analyzeContextGuard（返回是否已处理）/ analyzeModuleMode / analyzeFeatureMode / analyzeDocMode / analyzeOverviewMode / analyzeUnitModes，共 476 行（函数降至 2094 行）。依赖规则：`_projectRoot` 作参数传入；if 收窄丢失的字段（options.module/feature/doc）以非空断言恢复。apply 主块（约 1150 行）因跨块 needsClarify 数据流留待下轮抽取。

### 命令盘点精简（v8.3.341+）

67 个命令盘点后保留流水线核心、内部调用、进度导出与 welcome/help/about/doctor/dashboard 等友好命令，移除 20 个边缘命令：`knowledge`、`graph`、`rag-index`、`code-index`、`refresh`、`notify`、`workspace`、`recommend`、`baseline`、`diff`、`rollback`、`merge-check`、`verdict`、`impact`、`audit`、`history`、`handover`、`track`（注册名 trace）、`tracker`（死文件）、孤儿引擎 `smart-recommend`/`mermaid-render`。同步清理全部提及点：

- **运行时提示归位**：index-guard/doctor/analyze-engine/code-scanner/error-diagnosis 等 25 处「speccore refresh/code-index/verdict」提示统一改为 `speccore reindex` 或指向 ARBITRATION_REPORT.md 人工裁决入口；done 收尾中已删 audit 的内部 execSync 调用移除。
- **意图词典收敛**：intent-recognition 删除 6 个 IntentType 词条与 intent 块，「更新/刷新索引」类触发词统一映射 reindex；ask-engine 命令表/映射表/工作流同步清理。
- **展示面同步**：help 分类表、completion 补全数组、README 命令表、docs 系列（command-reference/commands.en/scenarios 双语/DESIGN/quick-reference 等 15 文件）、12 个 IDE slash 命令、init 生成的 SKILL 模板与 slash 模板、prompts 治理预设全部移除已删命令提及（历史版本演进表保留，废弃规划条目标注「已废弃」）。

### .speccore.yml 配置注释统一（v8.3.341+）

init 与 config --upgrade 生成的 .speccore.yml 注释统一为会议项目基准风格（字段名: 中文说明 + 取值 → 含义），并修正与真实代码不符的过时注释：

- **枚举值校正**：arbitration.mode 注释 simple → l1-only/report-only；settings.patterns.auto_save 注释 always/false → aggressive/off；ask.routing.mode 注释 local/llm → cli-only/host-ai-only；assignee.mode 补 off；arbitration 说明与 ai.defaults 说明中已更名命令 split → taskify。
- **新段注释补全**：vision 段 model/maxImagesPerPrompt/imageMaxSizeKb 补注释、provider 改「取值 → 含义」枚举式；agent_dispatch 段从段前「=」式改为 mode 字段注释 + 枚举式。
- **参考示例同步**：templates/speccore-yml-example.yml 与落地副本（.speccore/examples/config/SPECCORE-YML-EXAMPLE.yml）措辞对齐（block_level 说明/UI 验证段标题/devices-browsers 块写法/smoke 行内注释），机器锁测试保障同源。

## v8.3.340 (2026-10-21) — 三层命名一致 + 成员模型扩展 + PR 目标分支环境名引用

本版两大主题：①taskify 模块/子任务/Git 分支三层命名对齐功能单元名（去计数器、去端名冗余），Git 后缀默认 owner 拼音首字母；②成员模型扩展岗位/在项目口径/分支代号。另有迭代创建自动初始化成员与 Git 配置快照、运行时依赖声明修复（全局安装 MODULE_NOT_FOUND）、完成收尾全路径统一（execute 骨架填充兜底）、标题规范化改按需触发（默认关闭，ask 识别「按标准文档转换」）、config 升级链修复与静态 HTML 页面链路修复（引导页四模式页/提示词库链接 404 根治 + Qoder 宿主弹页展示指引）、成员通配语义（岗位/方向通配归一 + 匹配恒命中 + 候选推导防唯一误判）、PR 目标分支解耦（pr_target 独立配置 + 按分支类型区分）、execute --module 多值模糊匹配、PR 目标分支环境名引用（pr_target 与 environments/ 环境口径统一，v8.3.337~339 改动未单独发版，本版一并发布）。

### 三层命名链（模块 = 功能单元名，子任务 = Task-模块名）

此前三层命名各自为政：模块目录 Task-033-login-flow（全局计数器），子任务目录再拼端名（Task-033-login-flow-booking-service），分支名直接继承子任务 ID（端名跟着进了分支）。本次对齐功能单元目录名（与 features/、020-specs/ 完全一致）：

- **模块目录名 = 功能单元名**：`030-tasks/{type}/{功能单元名}`（如 admin-web-01-yudingguanli，无 Task-NNN 计数器）；非目录名格式的单元回退原计数器链。
- **子任务目录名 = Task-{模块名}**：端名由目录层级（{模块}/{端}/）承载，不再拼入子任务 ID；多端不主动区分，Git 分支重名时 `-hash4` 兜底（建分支前检测重名，已属于当前任务则复用）。
- **存量兼容**：旧命名目录不迁移；全项目 20+ 处 Task- 前缀消费面适配新命名（state/status-panel/knowledge-graph/reindex-engine/ask-context/spec-merger/name-validator/validator/cli/execute 等 16 文件），统一辅助 `isTaskModuleDirName`；findTaskDir 支持 Task-{模块名} → 父模块 = 模块名的定位链。

### Git 后缀 owner 拼音首字母

后缀优先级链：子任务 git-config > 全局 branch_types[branchType].suffix > owner 拼音首字母 > 不拼。子任务 .meta/owner 未显式配置后缀时自动取姓名拼音首字母（张三 → -zs，John → -j），成员表声明的「分支代号」优先；owner 为「未分配」/缺失不拼，分支名保持干净。新增 pinyin-pro 工具 toPinyinInitials（汉字段逐字取首字母、字母段取单词首字母）。

### 成员模型扩展（TEAM.md / STAFFING.md）

- **岗位维度**：roles（web/后端/移动端/测试/产品，可多个），与平台方向正交（岗位=技术栈，方向=业务端）；autoAssign 双维匹配 + 在项目过滤 + 负荷均衡。
- **在项目口径**：状态只看「是否在项目」（是/否），不看在职与否；词表兼容旧「在职/出项目」。
- **分支代号**（可选声明）：Git 分支后缀；留空自动拼音首字母，重名建议声明区分。
- **模板同步**：TEAM.md（9 列）/ STAFFING.md（5 列）主模板与 EXAMPLE 全族同步「岗位/在项目/分支代号」；mergeStaffing 新列空不覆盖（旧迭代 STAFFING 无新列不破坏基座值）。

### 迭代创建自动初始化（成员 + Git 配置快照）

`iteration create` 时把全局配置带出为迭代级快照，全自动执行等无人值守场景读迭代文件即有具体值：

- **成员信息**：STAFFING.md 创建时自动从全局 TEAM.md 带出成员快照行（岗位/方向/比例/在项目照抄当前值），此后基座变更不影响已建迭代；基座缺失/空表静默降级空表。
- **Git 配置**：PROJECT_GRAPH.md 的 Git 配置表格创建时从全局 PROJECT.yaml git 段带出默认分支/分支格式快照，未声明或值含表格破坏字符回落「继承全局配置」。
- **覆盖链不变**：任务级 .meta/git-config > 迭代 PROJECT_GRAPH.md > 全局 PROJECT.yaml > CONSTITUTION > 默认值；前缀/后缀保留拼接，中间主体按新命名链规则（分支 = 子任务名）。

### 运行时依赖声明修复（全局安装 MODULE_NOT_FOUND）

用户全局安装后运行 `taskify` 报 `MODULE_NOT_FOUND`（require 堆栈指向 dist/core/code-graph/parser.js），与 Node 版本无关——根因是 dist 产物引用了未声明的运行时依赖：

- **typescript 误入 devDependencies**：dist 的 code-graph/parser、structured-extractor 顶层静态 import typescript（TS 源码解析器），但 typescript 声明在 devDependencies，npm 全局/生产安装不装 → 必崩；移入 dependencies。
- **zod 纯 phantom dependency**：schemas/error-feedback 静态 import zod，但 zod 从未声明（靠 @modelcontextprotocol/sdk 传递依赖扁平化侥幸解析）；显式声明进 dependencies。
- **全量审计 dist**：inquirer（动态 import + try/catch）、xlsx（require 在 try/catch）为保护性动态加载，保留白名单不声明；其余外部模块全部收敛进运行时依赖。
- **机器锁防回归**：新增测试扫描 src 静态 import + dist require，外部模块必须 ∈ dependencies/optionalDependencies（白名单除外）；typescript/zod 不得回退 devDependencies。
- 端到端验证：npm pack → 干净目录 `--omit=dev` 安装 → 加载 code-graph/structured-extractor/schemas 全通过。

### config 升级链修复（branch_format 收尾）

- **DEFAULT_PROJECT_CONFIG 补 branch_format**：老项目 `config --upgrade` 自动补全并序列化带出。
- **YAML 引号事故**：序列化器输出 `branch_format: {type}/{prefix}{taskId}` 无引号，`{type}` 被解析为流式映射语法 → parseYaml 静默失败 → 升级写盘后整个 PROJECT.yaml 解析为空；改 JSON.stringify 加引号（生产级事故，机器锁抓出）。
- **开放式字典子树豁免**：原 OPEN_DICT_PATHS 全等匹配，递归进 git.branch_types.feature 子层后豁免失效，用户自定义 prefix/suffix 被误判 removed → config --upgrade 截停死循环；改前缀匹配。

### PR 目标分支解耦（pr_target 独立配置 + 按分支类型区分）

用户反馈「PR 目标分支不应该是 default_base，PR 分支要按环境区分（涉及部署）」。此前 default_base 一个字段背两个语义：既是 PR 合并目标（pr 命令），又是创建任务分支的源分支兜底（resolveTaskBaseBranch），Git Flow 项目（main 合入、develop 开发）下二者冲突。本次解耦：

- **default_base 回归单一语义**：只做「创建任务分支的源分支兜底」（branch_types[{type}].source 未配置时生效），模板注释/序列化注释全部同步修正。
- **新增 git.pr_target**：PR 默认目标分支独立配置，收录进 DEFAULT_PROJECT_CONFIG（老项目 config --upgrade 自动补全）。
- **branch_types[{type}].pr_target**：按任务类型区分 PR 目标，天然对齐部署环境线——hotfix 合 main（生产线）、feature 合 develop（测试线）；pr 命令从当前分支名第一段提取类型后查表。
- **回退链**：--base 参数 > branch_types[{type}].pr_target > git.pr_target > git.default_base > 'main'（default_base 兜底保留，存量零破坏）。
- 校验/序列化/示例全族（PROJECT-EXAMPLE.yaml）同步 pr_target。
- **环境名引用（v8.3.340+）**：pr_target（含 branch_types[{type}].pr_target）支持引用 environments/ 下环境名（如 pr_target: dev），自动取其 branch 字段（develop）——PR 目标与 pipeline/build/deploy 的环境口径统一；无同名环境或环境未声明 branch 时按纯分支名字面量使用（存量零破坏）。resolveEnvBranchRef 统一解析，含路径分隔符或 .yaml 后缀的值不做环境解析。

### execute --module 多值模糊匹配（模块目录名）

此前 --module 仅单值且只匹配 .meta/feature，多模块只能靠 --only 任务白名单变通。本次：

- **逗号分隔多值**：--module "支付,订单"（中英文逗号均可）任一命中即保留。
- **匹配面扩展**：功能单元名（feature）+ 模块目录名（id）+ 任务名（name）三面模糊包含——按模块目录名直接筛（如 --module yudingguanli）。
- 抽取 state.filterTasksByModule 共享辅助，execute 主执行路径与 --list-pending 双消费点统一；新增 5 例测试。

### 成员通配语义（岗位/方向 * = 全栈/所有方向）

用户反馈「成员职责和平台方向不光是数组，可能是全部（全栈开发）」，本次落地通配语义（零破坏：空 = 继承不变，表格一眼可读）：

- **解析归一**：TEAM.md / STAFFING.md 的岗位与平台方向写 `*` / all / 全部 / 所有 / 不限 / 全栈 / 全端 时，解析层整体归一为 [WILDCARD]（通配与具体值并列以通配为准）；导出 normalizeWildcard + isWildcard 供 analyze / taskify 两端消费。
- **匹配恒命中**：matchDirection（analyze 候选推导）与 taskify autoAssign 双维匹配（directionHit / memberRoleMatches）遇通配恒命中——全栈成员参与所有端的自动分配与负荷均衡兜底。
- **候选推导防唯一误判**：deriveOwnerCandidates 的通配成员不参与「方向唯一」判定，只有专向唯一命中才写 pending 候选，防全栈成员被误推为各端唯一负责人（保持报缺不脑补铁律）。
- **模板注释**：TEAM.md / STAFFING.md 模板说明同步通配用法；「全栈 + 指定方向」组合自然成立（roles=*、directions=H5）。
- 测试：unit-staffing-wildcard.test.ts 新增 6 例（归一 / isWildcard / 恒命中 / 解析归一 / 防唯一误判）。

### 静态 HTML 页面链路修复（ask 引导页链接 404 根治 + Qoder 弹页展示）

用户报障「HTML 页面打不开、链接跳转 404、升级后首次 ask 不弹引导页」，排查出三类根因并修复：

- **四模式页「← 返回 ask 引导页」404**：explain/guide/match/pipeline 四模板页链接 `speccore-welcome.html`，该文件名早已废弃（welcome 命令实际输出 `welcome-SpecCore.html`），模板目录与 outputs 均无此文件，点击必 404。统一改为链接真实存在的 `speccore-ask-onboarding.html`（每次 ask 弹页都会生成）。
- **「查看提示词库」链接 404**：setup-guide 与项目名片页链接 `speccore-prompts.html`，此前仅 `speccore prompts` 命令才会生成该页，普通 init/ask 后点击必 404。修复：prompts.ts 抽出可复用 `generatePromptsPage`，init 的 writeSetupGuide、welcome 命令、ask 弹页三入口联动生成 prompts.html（老项目无需重新 init，跑一次 ask 即补齐）。
- **升级后首次 ask 弹页但宿主不展示**：CLI 弹页逻辑（marker 版本比对）本身正常，断链在宿主 AI——SKILL 指引要求 `present_files` 展示，但 Qoder 无此工具导致标记被忽略。修复：spec-ask / speccore-router 两个 SKILL.md 增加 Qoder 环境展示指引（后台静态服务器 + RunPreview 打开，file:// 链接兜底），并补充 [SPECCORE_PROMPTS] 标记处理条目。
- 验证：outputs 内全部页面相对链接目标存在性校验通过；弹页全链路（marker 旧版本 → [SPECCORE_ONBOARD] 输出 → 7 个关联页面生成 → marker 更新）端到端验证通过。

### 完成收尾全路径统一（execute 骨架填充兜底）

此前完成骨架体检只挂在 `--apply`（runApplyMode）收尾里，宿主 AI 常用路径全部绕行：SDK 直连（子 Agent 直接写文件）直接 return、`--all` 直跑与批次路径只 generateTaskSkeleton——任务标完 completed 后端级文档仍保持空骨架。本版把完成收尾（标记 completed + 联动 TASK.md + 骨架体检 + 组级聚合）抽为公共函数 finalizeTaskCompletion，SDK 直连 filesChanged、`--all`、批次、`--apply` 四路径统一调用；组目录定位改用 isTaskModuleDirName 兼容新命名链。端级 REQ/TECH 骨架残留时 CLI 自动降级填充（从模块级 00-specs 真实规格派生端级快照），填不了的挂「骨架待补」双账本待办。新增 autoFillSkeletonFallback 单测 4 例（降级填充/骨架源不传染/前端四文档不降级/无模块源不误写）。

### 标题规范化改按需触发

v8.3.335 引入的 AI 标题规范化原为「转换后自动执行」，改为**用户明说才做**：默认不触发，仅当用户表达「按标准文档转换/调整」或显式 `--normalize` 时执行。

- **默认关闭，`--normalize` 显式开启**：原 `--no-normalize`（跳过）语义翻转，`--normalize`（开启）取而代之；默认转换后标题保持原样、不产生调整前快照，显式开启才 AI 重写 + 快照 backup/。
- **ask 准确识别「按标准文档」表达**：意图词典新增触发词（按标准文档/标准文档转 换/标准文档调整），参数提取层识别「按标准文档转换/调整」「标准标题」→ doc2spec  拼 `--normalize`；doc2spec 场景文件参数扩展支持 .docx/.doc/.pdf 提取。
- **顺手修复 ask 拼装断链**：doc2spec 的 `-f` 文件参数此前不拼入命令；`--iter`  此前误拼为未注册的 `--iteration` 死参数——迭代名静默丢失。两条均已修复。
- **测试**：+4 用例（按标准文档转换带文件/不带文件/无标准字眼默认关闭/混合表达）。

## v8.3.336 (2026-10-20) — Git 分支命名全局兜底：branch_format 模板 + branch_types 前缀后缀

全自动执行（execute --all / 无人值守流水线）创建任务分支时，迭代可能没来得及配置（PROJECT_GRAPH 缺失、未 taskify 无子任务 git-config），此前分支命名直接掉到硬编码默认 `{type}/{prefix}{taskId}`，用户的命名规范失效。本次把分支命名配置补进全局 PROJECT.yaml git 段作为兜底源。

- **新增 `git.branch_format` 字段**：分支名格式模板（支持 {type} {prefix} {taskId} {name} {date} {hash4} 变量），迭代 PROJECT_GRAPH / 子任务 git-config 未配置时生效；序列化/校验/示例模板三处同步。
- **`branch_types` prefix/suffix 全局兜底消费**：此前 prefix/suffix 只在 taskify 落盘子任务 git-config 时生效；现在 loadGitConfig 按任务分支类型查全局 branch_types 表（如 feature 配 prefix=api- → 全自动建分支自动产出 `feature/api-Task-XXX`），迭代/子任务未配置时生效。
- **优先级链不变**：子任务 .meta/git-config > 迭代 PROJECT_GRAPH.md > 全局 PROJECT.yaml > CONSTITUTION 回退 > 硬编码默认；子任务显式配置仍覆盖全局兜底。
- **测试**：+5 用例（模板兜底/查表注入/未配类型不受影响/无类型不查表/子任务覆盖优先级）→ 547/547 全绿。

## v8.3.335 (2026-10-20) — doc2spec 转换后自动标题规范化 + 调整前快照备份

产品原始文档标题常不规范（编号乱、层级乱、叫法怪），unitize 切分虽不挑标题，但切分边界精度与人工可读性受损。本次在 doc2spec 转换后新增一步：AI 按 SpecCore 标准标题体系语义重写标题，调整前版本自动快照备份。

- **AI 标题规范化（默认自动执行）**：转换完成后 AI 按标准标题体系重写——文档唯一 H1「{文档名}需求」、全局章节归 H2 标准名（文档概述/产品定位/项目背景/目标用户/用户画像/名词约定/术语表/功能架构/非功能需求/验收标准/上线计划/风险与缓解/关联文档）、功能模块归 H2「功能模块{中文序号}：{功能名}」、子节归 H3 常用标准名。`--no-normalize` 跳过；`--no-ai`/`--task` 场景自动跳过；AI 未配置时静默降级不阻断转换。
- **AI 只产映射、CLI 确定性回写**：AI 只输出「旧标题 → 新标题」JSON，CLI 逐行替换——正文一字不动、行数不变，天然防丢章节；未匹配映射的章节原样保留并警告，绝不静默丢失；映射命中过少（AI 输出质量差）时放弃本次规范化。
- **调整前快照备份**：规范化前把「调整前版本」快照到 `010-requirements/backup/{文件名}-{时间戳}.md`，随时可回溯对比（用户要求「以防要用」）。
- **测试**：+12 用例（大纲提取 2 + JSON 解析 3 + 确定性回写 7：编号容忍/同名按序对应/未匹配保留/H1 替换/层级兜底/行数不变）→ 542/542 全绿；mock LLM 端到端实测三条链路（有 AI 5 处重写+快照、无 AI 降级提示、--no-normalize 保持原样）。

## v8.3.334 (2026-10-20) — unitize 标题过滤 + 配置示例注释全量详化

切需求从「整文档一刀切」升级为「点名单切」：可以指定哪个文档的哪些标题，一次说完多个文档及其各自标题组，自然语言直接识别。另把四份配置示例的注释全面详化（含义/枚举/默认/影响），升级自动带出。

- **--titles 单文档标题过滤**：`speccore unitize --file x.md --titles "预订管理,消息中心"` 仅切指定标题章节。匹配语义为归一化（去章节编号）双向包含——「预订管理」命中「3.1 预订管理」「预订管理流程」；未命中标题 CLI 警告。
- **--files 多文档各自标题组**：`--files "a.md=端1@标题1|标题2,b.md=端2@标题3"`——文档与标题绑定，一次切多个文档的不同章节。
- **ask 引擎识别标题过滤**：「切 admin-web.md 里的预订管理、消息中心」→ `--titles`；「只切 a.md 的订单确认和 b.md 的扫码签到」→ 多文档 `--files @` 语法；新增 `.md 路径 + 切分动词` 锚点规则（裸「切分 xxx.md」不再依赖「需求文档」字样）。
- **全局章节不受影响**：标题过滤只作用于功能单元；产品定位/名词/验收标准等照常归 overview/。
- **默认发现模式防护**：`--titles` 仅配合 --file/--files 使用，自动发现模式提示忽略（多文档共用同一标题组易切错端）。
- **测试**：+11 用例（标题归一化匹配 5 + 分隔符解析 2 + 意图识别语料 4）→ 530/530 全绿；端到端实测：4 个候选只切出指定 2 个单元、多文档各自标题组分别命中。

## 配置示例注释全量详化（本版本第二批）

用户反馈示例书注释太精简，逐字段补齐：

- **SPECCORE-YML-EXAMPLE.yml（167→288 行）**：主配置每个字段配定义式注释——含义/枚举值/默认值/行为影响（如 block_level 的 standard/compile 差异、agent_dispatch 三态语义、smoke 三时机）。字段路径与取值逐项对账零差异，只添注释不碰字段。
- **VERIFY-EXAMPLE.yaml（142→208 行）**：头部新增三大字典——顶层字段、12 种 action 类型（navigate/fill/cookie/script/iframe/waitForRequest…）、5 种 assertion 类型（url/visible/text/count/style）；6 个场景逐 action 补注。
- **DEPLOY-EXAMPLE.yaml（511→540 行）**：头部新增 17 项公共字段字典（type/build_cmd/host/key/target/dockerfile/registry…）；ssh 旗舰示例逐字段注释。
- **PROJECT-EXAMPLE.yaml**：首个端配全量行内注释示范（端名/类型/源码路径/业务名逐字段）。
- **升级带出**：注释全部写在生成源（templates/ 静态模板 + init.ts 内联模板），`config --upgrade` 经 generateExampleConfigs 刷新 .speccore/examples/，下次升级自然带出；config-example-alignment 守护测试保证模板↔落地副本逐字节一致。

## v8.3.333 (2026-10-20) — 示例参考文件全线同步：升级时自动刷新 + CI 模板去幽灵命令

用户仿照修改的参考书（.speccore/examples/）此前只在 init 时生成一次，之后随版本凝固——本次全线对账并修复：

- **升级时自动刷新示例**：`speccore config --upgrade` 现在会同步刷新 .speccore/examples/ 全部参考文件（原仅 init 生成一次，升级后示例永远停留在旧版）。刷新失败仅告警不影响配置升级。
- **补齐缺失示例**：TEAM-EXAMPLE.md、STAFFING-EXAMPLE.md 代码早已生成但仓库/老项目缺失；README.md 目录声明与实际产物同步。
- **CONSTITUTION-EXAMPLE.md 补全两章**：新增「技术栈」与「异常码体系」章节 + v8.3.323 机器事实源说明（platforms[].code_path 为准），共补 31 行。
- **CI 模板去幽灵命令**：`speccore validate --full` 是 v5.3.0 遗留——现行 validate 选项为 --fix/--strict/--verify/--format，无 --full。用户照抄模板 CI 必报错，已改为 `speccore validate`。
- **对齐防线加厚**：config-example-alignment 测试 2→6 用例——新增 PROJECT 示例 vs DEFAULT_PROJECT_CONFIG 逐字段锁、六件复制类示例与 templates 同源锁、TEAM/STAFFING 存在锁、CI 模板命令与 CLI 注册表自动对账（以后示例落后测试先红）。
- **验证**：519/519 全绿；升级路径端到端冒烟（临时项目 → upgrade → 12 件示例全刷新）。

## v8.3.332 (2026-10-19) — 全面清查：图片路径类 bug 在其它功能中的同族变体（反斜杠进文本/基准错位/形态漏检）

承接 v8.3.331 图片路径四连修，全仓地毯式排查「反斜杠进 AI 可见文本 / 正斜杠拆分失效 / 形态漏检」同族问题，修 9 处 + 增 5 测试：

- **循环依赖检测失效**（analyzeDependencies）：relPath 未归一化时，graph key 为反斜杠而 import 路径为正斜杠——同一文件两种形态对不上，Windows 上循环依赖检测与报告路径全错。
- **目录深度限制失效**（walkDir）：`relPath.split('/')` 在 Windows 反斜杠下拆不开，深度恒为 1，maxDepth 形同虚设。
- **报告/AI 上下文反斜杠**：analyze-engine 三处（文件统计/hotspots/API 清单）+ prompt-builder 阅读清单元数据 + analyze 报告文档清单/模块索引 source 字段——统一归一化正斜杠。
- **markdown 链接反斜杠**：global-knowledge 文档索引链接、requirement-clarifier 命令示例参数（`\c` 在 md 里是转义符，用户复制即错）。
- **图片校验漏检/误报**（checkImages）：此前只认 `![]()` 语法，HTML `<img>` 旧产物完全漏检；反斜杠路径 basename 拆分失效导致误报。现支持 HTML img 形态（src/alt 顺序无关）+ 路径反斜杠归一化。
- **阅读清单锚点匹配**：formatSourceReadingList 的 symbolMap key 与查询均归一化，Windows 上 code-graph filePath 反斜杠不再导致锚点失配。
- **确认安全无需改动**：change-detection 的 `010-requirements/` 匹配（git 输出恒正斜杠）、zip 条目 `xl/media/`（ZIP 规范恒正斜杠）、doc-cross-reference（已有归一化）、analyze 需求键（逻辑键非文件系统路径）。
- **测试**：+5（validator 图片校验 HTML img 形态 3 + 反斜杠归一化 2）→ 515/515 全绿。

## v8.3.331 (2026-10-19) — 修复文档转换图片路径：反斜杠、路径失配、图片静默丢失三连修

- **根因 1（路径形态失配）**：doc2spec 的图片修正正则只匹配 `](media/`，但实测 pandoc 输出 `<img src="<相对cwd完整路径>" ...>`（HTML 标签 + 完整路径）——正则从未命中，md 里留下相对 cwd 的路径，从 md 文件位置解析必错。
- **根因 2（反斜杠）**：Windows 上 `path.join` 产出反斜杠，pandoc src 也带反斜杠——Markdown 里 `\` 是转义符，图片必裂。
- **根因 3（pandoc 图片基准是 cwd）**：实测 pandoc 解析图片相对路径的基准是 **cwd** 而非输入文件目录——spec2doc 单文件直转与多文件合并都会把图片路径错位解析（图片静默丢失）。
- **根因 4（HTML img 不嵌入）**：pandoc 的 gfm reader 不解析 raw HTML `<img>`，只有 markdown 语法 `![]()` 才嵌入 docx——doc2spec 产物里的 HTML 图片标签在 spec2doc 导出时全部丢失。
- **doc2spec 修复**：新增 `fixImageRefs`（pandoc 完整路径剥前缀 / 简写 media/ / 反斜杠归一化，统一转为「相对 MD 文件」正斜杠路径）+ `imgTagsToMarkdown`（`<img>` → `![alt](src)`，`<figure>` 图注剥 p 标签保留文本，丢弃 style 宽度属性）；两处调用点（.md 直接导入 + pandoc 后处理）全部接入。
- **spec2doc 修复**：新增 `rebaseImageRefs`（图片路径从源文件目录 rebase 到 cwd，外链/锚点/绝对路径不动）；单文件与多文件分支统一「rebase + img 转 markdown + 临时文件」路径。
- **共享工具**：`src/utils/markdown-image.ts`。
- **测试**：+11（fixImageRefs 5 / rebaseImageRefs 2 / imgTagsToMarkdown 4）→ 510/510 全绿；隔离项目端到端实测：docx → md 图片路径正确、md → docx 图片成功嵌入。

## v8.3.330 (2026-10-19) — 修复知识图谱双重 join：loadCodeGraph 从未成功加载（+ 阅读清单行号锚点真实生效）

- **根因**：`GRAPH_DIR` 定义为 `join(getProjectRoot(), '.speccore', 'code-graph')`（绝对路径），而 `path.join` 拼接绝对段不重置（只有 `path.resolve` 重置），`join(root, GRAPH_DIR, ...)` 拼出「root + 绝对路径」双份路径——`loadCodeGraph` 永远返回 null，知识图谱读取侧全面瘫痪（smart-recommend / analyze-graph-plugin / execute-graph-plugin / requirement-linker / graph 命令全部静默降级走「无图谱」分支）。
- **修复**：三个文件（code-graph/index.ts、requirement-linker.ts、incremental-build.ts）的 `GRAPH_DIR` 改为相对常量 `join('.speccore', 'code-graph')`，与调用方传入的 projectRoot join 后路径自然正确；不再依赖模块加载时的 getProjectRoot（顺带免疫加载期 cwd 变化）。
- **阅读清单锚点真实生效**：v8.3.329 的行号锚点因 loadCodeGraph 失败从未产出过——修复后实测 `符号 findRelevantCode:L276 readRelevantSource:L544` 精确指向导出符号。
- **锚点质量**：symbolMap 不再截断前 5 个节点（import 变量抢占名额导致导出符号漏出），改为非 variable 优先排序 + 渲染层按 exports 名定向匹配；仅当前两层均无命中时才兜底任意节点。
- **测试**：+2（loadCodeGraph 绝对 projectRoot 加载回归 + 锚点导出符号优先）→ 499/499 全绿。

## v8.3.329 (2026-10-19) — 源码零拼接：所有 AI 上下文统一「阅读清单」指针式交付

- **根因**：prompt 层早已阅读清单化，但分析报告（ANALYSIS.md）、代码审查（review）、执行缺口补充（INFO_GAP）、单元上下文组装（unit-context-assembler）四处仍读源码原文拼接（截断 preview / 4KB 切片 / truncateCodeFile）。
- **共享工具**：新增 `formatSourceReadingList`（code-scanner），把 findRelevantCode 命中转为「优先级 P0/P1/P2 + 匹配原因 + 导出符号/API + code-graph 符号行号锚点 + 深读协议」阅读清单，绝不含源码正文。
- **analyze 报告**：`readRelevantSource` 不再调用；「关联代码现状」→「关联代码导航」（阅读清单 + Read/Grep/LSP 深读协议）；「源码分析清单」删除 preview 拼接；`summarizeSources` 调用链移除（tree-sitter 摘要仅 java/go/py/rs，TS/JS 原文拼接是主噪音源）。
- **review 命令**：`findRelatedSource` 30KB/5 文件原文拼接 → 阅读清单。
- **execute INFO_GAP**：P1 源码回退不再写 4KB 切片，改为「缺口相关源码」阅读清单注入 supplement 文件；结构化精确匹配（DTO/Service 带 filePath:line）保留。
- **单元上下文组装**：`findRelatedCodeForUnit` 只记录路径与符号线索（知识图谱关联 40 分/P0）；`truncateCodeFile` 删除；`truncateByBudget` 源码段改为路径列表。
- **健壮性**：`loadCodeIndex` 对空/半写/损坏索引 JSON.parse 容错，返回 null 自动重建，不阻断分析（测试抓出的真实崩溃点）。
- **测试**：+7（formatSourceReadingList 6 用例 + analyze 阅读清单集成用例）→ 497/497 全绿。

## v8.3.328 (2026-10-19) — analyze 链路接入知识库：L2 规范注入 + RAG 语义召回兑 底

- **根因**：此前 analyze 链路的 RAG 索引只刷新不检索（索引只被体检从未被使用）；L2 规范（loadGlobalContext）也只注入 taskify/execute 的 prompt，analyze 完全未接入。
- **L2 规范注入**：新增 `collectKnowledgeContext`，分析时自动加载 `.speccore/GLOBAL/` 必读 + BUSINESS_RULES + RULES/（按 priority），注入分析报告「全局知识库」节。
- **RAG 兑底召回**：新增 `searchRagIndex`（中文双字组 + 英文单词加权打分，keywords ×3 / title ×2 / summary ×1），源码索引零命中时按需求全文语义召回规范/模式文档，注入报告「RAG 召回」节。
- **全链路覆盖**：纯需求（req）/ 纯代码（code）/ 混合（combined）三模式 + 全局/task/迭代三 scope 均接入；报告概览表新增「全局知识库」「RAG 召回」两行。
- **修复**：检索查询词由需求路径列表改为需求全文（路径里不含业务关键词，原实现召不回任何文档）。
- **修复**：`chunkByHeaders` 只认二至四级标题，只有一级标题的规范文档（如 `# 安全规范`+正文）索引 chunks 为 0——一级标题也参与分块。
- **修复**：迭代层刷新只索引迭代目录，全局规范索引（rag-index-global.json）从未在迭代层分析时刷新——`refreshRagByScope` 无条件同步刷新规范库；知识底座刷新前移到分析之前，首次分析即生效。
- **修复**：全局索引回退整目录索引 `.speccore` 会把 CONSTITUTION/PROJECT.yaml 等配置文件变成召回噪音——只索引四层架构目录（GLOBAL/RULES/SKILLS/PATTERNS）。
- **修复**：`searchRagIndex` 从「迭代优先回退全局」改为「迭代 + 全局合并检索」，规范库才是知识库主体。
- 测试：490/490 全绿（+11）。

## v8.3.327 (2026-10-19) — CI 第二层修复：coverage 依赖补齐 + 锦上添花环节不阻断发布

- **根因**：lock 修复后 CI 首次跑到 `vitest run --coverage`，报 MISSING DEPENDENCY（devDependencies 无 `@vitest/coverage-v8`）——此前被 npm ci 失败截停从未暴露。
- **修复**：安装 `@vitest/coverage-v8@^1.6.0`；本地验证 coverage 全链 479/479。
- **ci.yml 加固**：codecov 上传与 CodeQL 两步加 `continue-on-error: true`（私有仓库无 token / 无 Advanced Security 许可时不阻断 publish）。
- 注意：v8.3.326 已推 tag/release 但未发布成功，由 8.3.327 承接。

## v8.3.326 (2026-10-19) — CI 发布通道修复：package-lock 同步恢复 npm ci 一致性

- **根因**：package-lock.json 自 8.3.290 后未随版本 bump 同步，CI 的 `npm ci` 严格校验直接失败（Actions 长期红，npm 上线版本靠本地 web auth 绕行）。
- **修复**：`npm install --package-lock-only` 同步 lock 至当前版本；发版流程自此包含 lock 同步步骤。
- 注意：v8.3.325 已推 tag/release 但未发布成功（CI 红），由 8.3.326 承接发布。

## v8.3.325 (2026-10-19) — constitution-builder 接线：技术栈自动检测写入主 CONSTITUTION 决策式表

- **constitution-builder 重构**：写入目标从 `.speccore/PROJECT/CONSTITUTION.md`（无人读取的副本）改为 `.speccore/CONSTITUTION.md` 主文件的「技术栈」节，与 v8.3.324 决策式表对齐；检测产出「语言/框架/数据存储/依据」四列，端名列留待用户拍板（不脑补）。
- **init 接线**：模板生成后自动检测（pom.xml/build.gradle/package.json/go.mod/requirements.txt/源码扫描），示例行整体替换为检测行（端名用项目名）。
- **update 接线**：仅当技术栈表未填时补填检测行；已填不动（不覆盖用户数据）；旧菜单格式仅提示不破坏。
- **删除框架通用规则**（RESTful/PR 审查/created_at 等），符合 AGENTS.md 禁令 12。
- **typescript 判定收紧**：仅显式依赖 typescript 才判 TS，纯 JS 项目不再误判。
- 新增 tests/unit/core/constitution-builder.test.ts（11 用例：检测分支 + freshTemplate/存量已填/存量未填/旧格式/文件缺失）。

## v8.3.324 (2026-10-19) — CONSTITUTION 模板族升级：决策式技术栈 + 分段异常码 + 模板族机器锁

### 背景
- CONSTITUTION.md 的「技术栈」是菜单式罗列（Java/TS/Go/Python + 四框架），AI 拿到的是排除法信息而非正选答案；「异常码体系」是几个枚举示例（1001/1002），AI 无法从中获得生成能力；且主模板与 examples/ 示例是多份独立字符串，新语义靠人肉同步，漏同步无机器拦截。

### 新增
- **技术栈改决策式**：每端一行写「已选定」的技术与版本（含依据列，如 pom.xml/package.json）；可选技术域降为末尾的「约束参考」；未填写的端回退到端级 TECH.md（analyze 产物）。主模板与 CONSTITUTION-EXAMPLE 同步升级。
- **异常码改分段规则**：按段划分（如 1xxx 用户/2xxx 订单）+ 生成规则（首位=模块段、后三位=段内序号）——给 AI 生成能力而非几个例子。
- **examples 新增人员配置示例**：TEAM-EXAMPLE.md（全员基座 7 列含状态）、STAFFING-EXAMPLE.md（迭代差异 4 列含状态，演示出项目/临时复活语义）；存量项目跑 update 即可照抄最新样式。
- **模板族一致性机器锁**：tests/unit/commands/template-consistency.test.ts 集中登记关键语义锚点（机器事实源/决策式/分段规则/状态列等），行为级比对主模板与 EXAMPLE，任一缺锚点即红。

### 修改
- CONSTITUTION-EXAMPLE 补 v8.3.323 platforms 指针 + 技术栈/异常码决策式示例；examples README 清单与使用方式同步（第 11 条）。
- 命名规范充实：目录约定（全小写短横线）、Git 提交格式（type(scope)）等。
- 本仓库 .speccore/CONSTITUTION.md 填真：技术栈改 ts-cli 决策式单行（TypeScript 5/Node.js/无数据存储）、异常码改真实退出码约定（0 成功/1 一般错误/10 主机 AI 接力）、项目信息「对应端」填「—」（CLI 单工程）、端列表注释如实标注为测试迭代示例端。

### 测试
- 新增模板族一致性机器锁 4 用例；全量 468/468 通过。

### 背景
- v8.3.322 收敛了「Git 分支策略」，但「项目信息」表（端列表/源码路径/Git 仓库）仍两头消费：parseGlobalPlatforms、loadSourcePathMap 只认 CONSTITUTION.md 表格，而 PROJECT.yaml platforms 已声明同构字段；保护分支两处不一致时静默「合并」，用户不知哪份生效；冲突时反复告警刷屏。

### 新增
- **项目信息表收敛（v8.3.323）**：`parseGlobalPlatforms`（端列表权威）与 `loadSourcePathMap`（源码路径→端映射，变更检测用）改为 PROJECT.yaml `platforms` 声明即准、未声明字段回退 CONSTITUTION「项目信息」表——与 Git 段同构的「声明即准 + 回退」模式；CONSTITUTION.md / init 模板的「项目信息」节加机器事实源指针。
- **保护分支严格收敛**：PROJECT.yaml 声明了 protected_branches（全局或端级）即以它为准（不再与 CONSTITUTION 并集）；显式声明空列表 = 完全关闭该层保护分支；未声明才回退 CONSTITUTION「保护分支」行。
- **不一致一次性告警**：PROJECT.yaml 与 CONSTITUTION 对应字段不一致时，首� ��写入一次指纹 marker 后不再重复（同值重录即消），避免每次命令都刷屏。

### 修改
- `installGitHooks` shell 模板纳入 PROJECT.yaml protected_branches（与同步/异步检查同口径）。
- 本仓库 `.speccore/CONSTITUTION.md`、`.speccore/PROJECT.yaml` 实例同步加指针。

### 测试
- git-integration-subtask / platform-registry 新增覆盖语义、显式清空、默认兜底、告警去重用例；全量 464/464 通过。

### 背景
- CONSTITUTION.md「Git 分支策略」与 PROJECT.yaml `git` 段都有 Git 配置（默认分支/保护分支），但消费链各说各话：loadGitConfig/getProtectedBranches 只认 CONSTITUTION，resolveTaskBaseBranch/getEffectiveGitConfig 只认 PROJECT.yaml，同一字段两份值各管一段；PROJECT.yaml 头注释宣称「update 自动同步到 CONSTITUTION」、init 模板宣称反向同步，而 update 命令实际都不做。

### 新增
- **loadGitConfig 全局层收敛**：PROJECT.yaml `git` 段（同步解析原始文件，新增 loadRawProjectGitSync）为主源——default_base→默认分支、protected_branches（全局+端级合并）→保护分支；CONSTITUTION「Git 分支策略」降为 AI 契约回退，每字段独立（仅 PROJECT.yaml 未声明时回退，如「任务分支」类型段、依赖合并策略等 PROJECT.yaml 无对应表达的字段）。
- **getProtectedBranches 同步版收敛**：与异步合并版同口径——PROJECT.yaml 全局+端级为主源、CONSTITUTION 回退；isProtectedBranch 同步检查随之修复（此前 PROJECT.yaml 配置的保护分支在同步路径从不生效）。
- **Git hooks 纳入 PROJECT.yaml**：pre-commit/pre-push 的 shell 保护分支检查在 CONSTITUTION grep 后追加 PROJECT.yaml `protected_branches`（全局+端级）提取。

### 修改
- 文档方向统一：PROJECT.yaml 头注释（模板 toProjectYaml + 本仓库实例）改为「本段为 Git 配置机器事实源」；init.ts 四处反向声明（CONSTITUTION 模板指针、字段对照表、examples/README、CONSTITUTION-EXAMPLE）改为准确描述——CLI 只认 PROJECT.yaml，CONSTITUTION 是 AI 阅读契约/兼容回退。
- 本仓库 .speccore/PROJECT.yaml、CONSTITUTION.md 注释同步修正（不动 schema 字段）。

### 测试
- git-integration-subtask.test.ts 新增 4 用例：PROJECT.yaml 覆盖 CONSTITUTION、每字段独立回退、getProtectedBranches 全局+端级+CONSTITUTION 合并、无 PROJECT.yaml 兼容回退。459/459 全绿。

## v8.3.321 (2026-10-19) — 成员状态：出项目成员不再参与自动填充

### 背景
- 团队有成员出项目时，无状态标记——analyze 候选推导、taskify 负荷均衡仍会把已离开的成员自动填充到新任务上。

### 新增
- **「状态」列**（TEAM.md 全员基座 + 迭代 STAFFING.md 差异层）：在职（缺省）/ 出项目，归一化识别（出/离/停/inactive 均可）；出项目成员在 loadStaffing 合并后统一剔除，analyze 推导与 taskify 分配自动跳过，只选在职成员。
- **状态也是可覆盖差异**：迭代层写「在职」可复活基座出项目成员（如临时回归），写「出项目」可局部停用；留空继承基座状态；旧表无状态列全员在职（兼容不变）。
- 已拍板（confirmed）/已固化的 .meta/owner 不受影响——状态只影响未来自动填充。

### 修改
- init.ts / create.ts 模板同步加「状态」列与说明。

### 测试
- unit-staffing.test.ts 新增 5 用例（剔除出项目/迭代复活/局部停用/旧表兼容/唯一候选跳过）；全量 455/455 零回归。

## v8.3.320 (2026-10-19) — 人员链路下游补齐：execute 单任务读 owner + TASK_SUMMARY 人员维度

### 背景
- 排查「子任务开发人员是否都来自团队配置」时发现两处断链：①execute 单任务路径（--task）taskState.assignee 硬编码空串，不读 .meta/owner——执行单任务时计划/分支展示的负责人落空（批量模式 scanTasks 正常读）；②TASK_SUMMARY 任务总览无负责人列，也没有按人统计的维度。

### 修复
- **execute 单任务路径读 .meta/owner**（execute.ts）：与批量模式 scanTasks 口径一致，单任务执行的计划展示/分支命名不再缺负责人。
- **TASK_SUMMARY 加「负责人」列 + 人员分布统计**（taskify.ts）：任务清单表新增负责人列（confirmed 拍板/autoAssign 分配结果）；汇总区新增「人员分布」表按负责人统计任务数。

### 测试
- 全量 450/450 零回归。

## v8.3.319 (2026-10-19) — 人员配置两级继承：全局 TEAM.md 全员基座 + 迭代 STAFFING.md 差异覆盖

### 背景
- 团队名册无「一次维护」机制：全局 .speccore/PROJECT/TEAM.md 只有成员/Git 映射列（无方向/比例），无人消费；每开一个迭代都要把 STAFFING.md 从头重填一遍，团队稳定时重复劳动。

### 新增
- **TEAM.md 升为全员基座**（init.ts）：表头新增「平台方向/投入比例」两列（原有 Git 映射列保留），登记即被所有迭代继承；旧版无「平台方向」列的表兼容读取（基座不参与合并，行为不变）。
- **loadStaffing 两级合并**（unit-staffing.ts）：全局 TEAM.md 为底 + 迭代 STAFFING.md 差异覆盖——同名成员整体覆盖方向/比例（方向留空 = 本迭代不做该方向，0% = 不参与），迭代独有成员追加，未列基座成员默认保留；已建迭代即时生效，无需重开。
- **按表头定位列解析**（parseStaffingTable）：兼容 TEAM.md 多列与 STAFFING.md 三列的列序差异；中间空列保留（「| 张三 | | 0% |」方向留空不再错位）。
- **autoAssign 跳过 0% 成员**（taskify.ts）：投入比例 0% = 本迭代不参与分配（如休假），此前 0 < Infinity 恒真会把 0% 的人优先分配。

### 修改
- taskify readStaffing 删除重复解析实现，复用 unit-staffing 合并结果；无配置提示文案同步提 TEAM.md。
- iteration create / init 示例的 STAFFING.md 模板注明「只写差异，全员基座见 TEAM.md」。

### 测试
- unit-staffing.test.ts 新增 7 用例：纯基座继承、同名覆盖/独有追加/基座保留、方向留空+0% 覆盖、旧版表兼容、按表头定位、merge 快捷路径；全量 450/450 零回归。

## v8.3.318 (2026-10-19) — 增量切分闭环：内容切分 + 翻译接力对齐 + 章节序号回源

### 背景
- 验证「需求新增功能单元/新文档/一段内容切分」四个场景时，隔离副本实测暴露三处断链：①宿主翻译接力（--translate-response）序号基准错位——增量重切时旧单元缓存命中，PROMPT 清单只剩新单元，但响应按全量标题对齐，{"1":"push-preference"} 被错位写到「站内信通知」，新单元反而降级拼音；②切分序号沿用 written+1，增量重切时旧单元被 skip 后新章节（第 4 章）拿 01，与已有 01-inbox 序号撞车且破坏「排序==文档顺序」；③「一段文档内容切分」无入口（只能 --file 文档路径）。

### 修复
- **翻译接力序号基准改待翻译清单**（doc2spec.ts）：translateResponse 解析基准从全量 titles 改为 misses（与 [SPECCORE_PROMPT] 输出清单同源），增量重切不再错位；misses 计算提前，响应写缓存后重算。
- **切分序号回到文档章节序号**（doc2spec.ts）：seq = unitIndex+1，幂等稳定（重切/增量切分目录名不变），替代 written+1 的产出序。
- **unitize --content 内容切分**（unitize.ts + cli.ts）：`-c, --content <文本>` 直接切一段文档内容——自动落盘 010-requirements/converted/{文档名}.md 后走常规切分；文档名取 --title 或内容首个 H1（转 ASCII 文件名），两者皆无报错指路。
- **ask 内容切分意图**（intent-recognition.ts + ask-engine.ts）：信号词（这段内容/以下内容/…）+ 冒号后含 Markdown 标题才提取 content/title（.md 路径优先，防误提取）；ask-engine 拼 `--content`/`--title`（双引号转义）。
- **help 同步**（help.ts）：unitize 参数表补 --content 条目。

### 测试
- intent-recognition.test.ts 新增 3 用例：内容切分提取 content/title、.md 路径优先不抢 content、无信号词不误提取；全量 444/444 零回归。
- 隔离副本 E2E：增量重切（已有 3 单元 skip + 第 4 章产出 04-push-preference）、二次重跑幂等（4/4 全 skip）、run 自动发现新文档切分、--content 落盘切分、ask 三条语句识别、TTY 三选一渲染。

## v8.3.317 (2026-10-19) — 增量重切与 ask 识别修复

### 背景
- 实测四场景（需求新增功能单元重切/指定新文档/ask 识别/run 自动交互）发现：①ask 对「需求中新增了功能单元，需要重新切分」被 create 任务抢走（100% vs 92%）；②「切分需求文档 docs/新需求.md」未提取文件参数；③无参数命令 ask 输出畸形执行标记（speccore unitize speccore unitize）；④run --from split-units 在 features/ 非空时直接跳过，增量重切无从执行；⑤重切时「系统公告」重复产出（旧 SOURCE.md 含「涉及端」元数据行、新切无 platform，指纹不同 + Jaccard 0.833 < 0.85 双漏）。

### 修复
- **ask 引擎**（ask-engine.ts）：autoExec 参数提取改首空格拆分，无参数命令不再把整串命令当 args（修复畸形标记）；unitize 拼 `--file "${params.file}"`。
- **意图识别**（intent-recognition.ts）：ANCHOR_RULES 新增增量切分强锚点（重新切分/再切/增量切分 +30）与 create/new_task 让位规则（功能单元/需求文档+切分共现 -35）；extractParams 提 .md 路径 → params.file。
- **run 增量重切**（run.ts）：`--from split-units` 显式指定时视为增量重切（不因 features/ 非空跳过），切分传 onDuplicate=skip——已有单元跳过、新增章节自动产出；自动断点场景保留跳过（幂等）。
- **同名检测加固**（doc2spec.ts）：标题（两侧剥章节序号对齐）+ 指纹相同或 Jaccard>0.6 即视为同名——platform 缺失导致的元数据行差异不再漏拦。

## v8.3.316 (2026-10-19) — 切分命名链路边界修复

### 背景
- 检查「功能单元命名 → 任务模块 → 子任务命令」链路发现：①stripUnitSeqPrefix 重叠扫描漏洞——plan-24-01-inbox 的 -24- 与 -01- 共享连字符，默认 lastIndex 跳过导致漏计候选、误剥成 01-inbox 残片；②任务目录前缀匹配无边界——Task-033 会误命中 Task-0331-xxx 兄弟目录。

### 修复
- **重叠扫描**（taskify.ts）：正则 lastIndex 回退 m.index+1 允许重叠，plan-24-01-inbox 两候选全部计入，宁全勿残。
- **前缀边界**（task-paths.ts / done.ts）：前缀命中后下一字符必须是 '-' 或串尾，findTaskDir 与 scanForTask 同源修复。

### 测试
- 新增 find-task-dir.test.ts 5 用例（精确命中/不误命中 Task-0331/无 topic 后缀/兄弟共存/子任务完整 ID 递减定位）；全量 441/441 零回归。

## v8.3.315 (2026-10-15) — 升级机制根治：版本戳驱动迁移 + 序列化器机器锁

### 背景
- 配置升级「总是出问题」的根因是结构性的：①单一事实源被人肉复制成多份（DEFAULT_CONFIG → 接口 → 手写序列化器 → 注释），改一处忘一处即产生假补全；②内置资产升级靠「枚举旧特征」检测，每次改版都要新枚举，漏一个就是一个盲区；③资产刷新与投影/索引等多消费点判定不统一，备份文件污染下游。

### 修复
- **机器锁**（config-serializer-consistency.test.ts）：DEFAULT_CONFIG 与手写序列化器 toYaml 双向一致性校验，新增字段漏写输出段当场红——「人肉记忆」变为「构建期把关」。
- **版本戳驱动迁移**（asset-stamp.ts）：内置资产（AGENTS 角色/注册表/RULES inline 投影模板）写盘时注入 `<!-- speccore-asset-version -->` 戳；升级时凭戳判定：旧戳→备份刷新、同版本→保留（用户改过不覆盖）、无戳→旧特征兜底（命中则备份刷新，否则视为用户自定义保留）。改版无需再枚举旧特征。
- **restamp 过渡分支**：8.3.314 及以前生成的无戳同内容文件，升级时直接补戳进入版本戳体系（内容零变化、零备份），存量项目平滑入轨。
- **统一决策表**（decideStampedSync）：四类内置资产共用同一决策函数，新增资产类别不再引入分支逻辑。
- **消费点一致性**：inline 备份文件过滤与剥戳下沉到 syncAgentsMd（投影）、rag-engine（RAG 索引扫描/增量检测）两个消费点——备份不进投影表、不进语义索引；inline 覆盖一律 safeWriteWithBackup 保底可回滚。

## v8.3.314 (2026-10-15) — 升级盲区三连修：旧项目升级后规范库同步到位

### 背景
- 会议项目升级到最新版后体检发现三个升级盲区：①RULES/*.inline.md 三份旧版（「dev 后生成」「必须开始新对话」旧文案、缺 run 快捷操作）投影进 AGENTS.md 后残留在新项目里；②旧项目缺 CODE_REVIEW.md / POST_COMPLETION.md 两份规则，AGENTS.md 引用断链；③AGENTS/*.md 角色文件旧 frontmatter（缺 name/title/systemPrompt），子 Agent 激活降级。

### 修复
- **过时检测双通道**（init.ts）：OBSOLETE_MARKERS 新增「dev 后生成」「必须开始新对话」两命中型标记；inline 模板支持 `required` 缺失型检测（新版独有内容块缺失即视为过时：01-SOURCE.md、02-SPECCORE_NEEDS_INFO、03-run 快捷操作）；01 结构图补 SOURCE.md 行与规范对齐。
- **EXTRA_BUILTIN_RULES 常量**（init.ts）：CODE_REVIEW.md / POST_COMPLETION.md 内容抽为常量统一维护，createDefaultFiles（首次 init）与 initRulesDir（update 路径）双处消费——旧项目重跑 init --update 自动补写，断链闭合；已存在不覆盖（用户定制保留）。
- **AGENTS 智能刷新**（initAgentsDir）：旧版角色文件（缺 systemPrompt + 正文「# 角色：」标题）自动备份并刷新为新版 frontmatter；旧版注册表（缺「叠加 RULES/」上下文列）同样备份刷新；用户自定义文件（自建 frontmatter）不受影响。
- **备份文件消费点过滤**（syncAgentsMd + scanAgentFiles）：刷新产生的 `{name}-{时间戳}.md` 备份文件此前会被扫进 AGENTS.md 角色表并加载成伪角色——两个扫描点统一用 isTimestampBackup 过滤，备份只留痕不入表。

### 测试
- 新增 init-refresh.test.ts 10 用例：inline 命中型/缺失型过时检测、幂等不误刷、EXTRA_BUILTIN_RULES 补写与用户定制保留、AGENTS 旧版角色/注册表备份刷新、用户自定义不覆盖、时间戳备份不污染 AGENTS.md 投影；全量 413/413 零回归。



### 背景
- 用户实测：任务 execute 完成（completed）后，端级文档仍留空骨架（SPEC-SKELETON / _待AI分析_ / AI-FILL）。根因：覆盖骨架只是 prompt 软指令，完成时仅 `logger.warn` 一句——不阻塞、不追溯；且旧检查只查任务根 REQ/TECH 两份，子任务目录与前端四文档（STATE/ROUTES/COMPONENT_TREE/STYLE_GUIDE）全是盲区。

### 修复
- **新增完成骨架体检**（`src/core/skeleton-residue.ts`）：`collectSkeletonResidues` 递归扫描任务目录（组级穿透到 {端}/{子任务}/ 层），覆盖 REQ/TECH + 前端四文档共 6 份，识别 SPEC-SKELETON、_待AI分析_、AI-FILL 三类标记；跳过 00-specs/_shared 等模块级共享文档。
- **残留处置：completed 照常 + 双账本待办**（`execute.ts`）：命中残留时状态不改，但 TASK.md 追加「⚠️ 骨架待补清单」节（幂等：先摘旧节再写新节）、.issues.md 追加 `[骨架待补]` issue（幂等：先摘旧行再写新行）——下游审查/回归有据可查，不卡流程。
- **精确覆盖清单**（`buildAgentContext`）：子任务 Prompt 列出本端 6 份骨架文件的精确路径（if exists 必须覆盖），AI 不再有「找不到/忘了哪几份」的借口。

### 测试
- 新增 skeleton-residue 单测：组级递归穿透、6 份文档名单、三类标记识别、00-specs/_shared 跳过、实文不误报；全量测试零回归。


### 背景
- 用户实测：在已有功能模块任务下新建子任务（补缺失的端）时，ask 识别不了，误建了新模块任务；且上游 020-specs 没有该端分析，硬建子任务只会拿到空模板。另：unitize 重切后 features/ 下的时间戳备份目录被质量扫描当正常单元重复扫描（报告里同名 SOURCE.md ×7 堆叠）

### 修复
- **新增「补子任务」意图**（intent-recognition.ts）：`task_append`（priority 88，高于 task new 两条目）——triggers 补子任务/补个端/少了一个端/新建子任务/加个子任务等 16 词，patterns 8 条，配套子任务锚点共现 +25 与 new_task/create 子任务短语让位 -40；「新建一个子任务」不再被宽词误路由为新建模块任务
- **ask 路由**（ask-engine.ts）：`task append` 分支——从输入提取 Task 编号（extractParams 已有）与端名（parsePlatformList 反向匹配），生成 `speccore task new --into Task-XXX --platform 端名`；无 Task 锚点时回退新建并附提示
- **task new 补端入口**（new.ts）：`--into Task-NNN --platform 端名`——定位宿主任务（兼容 030-tasks 两种布局）→ 创建 `{端}/Task-NNN-{端}/` 子任务（.meta 齐备）→ TASK.md 由上游端级规格提炼（标题摘录 + 源路径索引，非空模板）→ 任务 00-specs/CHANGELOG.md 追加补端记录 → 更新当前任务上下文
- **上游门禁**（new.ts checkUpstreamPlatformSpec）：补端前检查 `020-specs/{功能单元}/{端}/` 是否存在非骨架且 ≥200 字符的 TECH/TEST/UI_SPEC（与 taskify 端裁剪同一判定标准）；缺失则拦截并给出「先 analyze --platform 再补端」正确两步，`--skip-gate` 逃生舱强制建（TASK.md 明确标注「上游待补」）；端名非 CONSTITUTION 端列表成员直接拦截
- **质量扫描排除时间戳备份目录**（analyze.ts generateQualityReport）：递归扫描 010-requirements/ 时跳过 `isTimestampBackup` 目录（unitize overwrite 备份），备份目录内旧版 SOURCE.md/_matrix.md 不再污染质量报告

### 测试
- intent-recognition.test.ts 补子任务语料 5 句（两种迭代模式双跑）+ Task 编号提取用例；task-append.test.ts 补端模式 6 用例（上游达标补端/门禁拦截/--skip-gate 标注/已存在跳过/端名非法/宿主不存在）；全量测试零回归

## v8.3.310 (2026-10-12) — 模块任务聚合：关联任务按模块组织 + 模块公共约束 spec

### 背景
- 用户需求：用户建了很多任务，有关联的应该像 feature 任务一样放在一个模块里，模块内有公共约束 spec；其他单个任务仍按单个处理；自定义类型的长任务链不需要新目录——复用现有 030-tasks 二层结构，第三层子任务天然安全

### 新增
- **task new --group 聚合模式**（new.ts）：批量创建时加 `--group <模块名>`，关联任务合并为一个模块任务——模块目录结构对齐 feature 任务（`.meta/` + `00-specs/` + `_shared/`），子任务按 `01-{slug}/` 序号平铺在模块目录下（第三层）；模块名与子任务名同批英译（LLM 英译 + 拼音兜底）
- **模块公共约束 spec**：`00-specs/CONSTRAINTS.md` 落模块目录的公共位置（组内所有子任务的共同前提约束），模板含通用纪律/产出要求/验收标准三节；chain 每次执行子任务前重新读取注入，修改即生效；`00-specs/REQ.md` 自动维护子任务清单总览（序号/名称/状态表）
- **模块任务标记**：`.meta/module-group = true`——chain 据此识别模块任务；`scanTasks` 只扫两层，第三层子任务不会被误认为独立任务（模块与单任务天然隔离）
- **chain 模块展开**：模块任务展开子任务序列，逐个推进——找第一个未完成子任务 → 输出子任务执行 prompt（含模块公共约束 + 子任务/模块 spec 声明 + 全局约束集注入 + 代码形态判定）→ exitCode 10；全部子任务 done 后自动更新模块 `.meta/status = done` 继续下一任务
- **模块级重试策略**：尝试上限 = 子任务数 × 2（每个子任务最多 2 次推进），避免长链模块被单任务 2 次尝试限制误判失败
- **子任务目录结构**：`.meta/status`（done 即完成）+ `TASK.md`（专属说明，指向模块公共约束）

### 设计决策
- 自定义类型长任务链**不新建目录**：复用 `030-tasks/{type}/Task-NNN/` 二层结构，子任务放第三层（`Task-NNN/01-{slug}/`）；新顶层目录会破坏 scanTasks/verify/dashboard 等所有二层扫描器的兼容性，第三层方案零侵入
- 模块目录对齐 feature 任务的 Task 目录结构（.meta/00-specs/_shared），用户心智统一

### 测试
- 新增 module-group.test.ts 6 用例（约束模板组名与注入提示/三大节/修改生效提示；子任务模板标题与描述/done 要求/空描述无残留空行）；全量 414/414 通过

## v8.3.309 (2026-10-12) — 单单元裸 slug 英译修复 + 任务目录与功能单元一一对应

### 背景
- 用户实测反馈：切分功能单元目录名还是拼音（单单元时也拿不到英文）；后续 020-specs 分析目录已对齐切分单元，但 030-tasks 任务目录是「随机数字」（Task-033-21 残片），希望任务目录与切分单元一一对应

### 修复：英译链路
- **单标题裸 slug 兜底**（ask-llm.ts parseTranslationResponse）：宿主 AI/LLM 对少量标题常直接输出裸 slug（无 JSON 包装/序号，单标题尤其常见，如只回 `inbox-notification`），此前解析 0 条 → warn「未解析出有效翻译」→ 拼音兜底。现单标题整串合法 kebab-case 即映射；多标题行数与清单一致时按行序一一映射（支持带引号/序号前缀剥离）
- **LLM 失败显式提示**（doc2spec.ts translateUnitTitles）：① callLlm 返回空（已配置但调用失败）补 warn「LLM 调用失败（无有效响应）」+ 宿主接力建议；② 有响应但 0 条可解析时打印响应片段（此前两条路径均静默降级拼音）

### 修复：任务目录对齐
- **stripUnitSeqPrefix**（taskify.ts）：剥离功能单元目录名 {文档}-{序号}- 前缀取语义尾段（new-feature-notification-01-inbox-notification → inbox-notification），年份式 4 位数字（meeting-2024-01-x）回溯不误剥
- **buildTaskTopic 优先级调整**：非 bugfix 任务 topic 改为「功能单元目录名（剥离前缀）优先 → AI 自创 topic → 中文名拼音/拉丁片段」，任务目录 Task-NNN-{语义段} 与切分单元一一对应
- **functionalUnit 兜底**：AI 回填中文/自创名时，从 sourceFile 提取 features/{单元} 或 020-specs/{单元} 目录名（修复 Task-033-21 类残片）
- **taskify prompt 强化**：feature/refactor/research 的 functionalUnit 必须原样填写功能单元目录名（禁止自创、禁止中文），并说明任务目录派生规则

### 测试
- translation-response.test.ts 新增 4 用例（单标题裸 slug / 引号剥离 / 多行行序 / 非法回退）；新增 unit-seq-prefix.test.ts 6 用例（标准剥离 / 自创名原样 / 年份回溯 / 中文原样）；全量 408/408 通过

## v8.3.308 (2026-10-12) — 开放类型系统：自定义任务类型 + 无分支执行 + 演示文稿 类型

### 背景
- 用户场景延伸：写总结、做 PPT 等与编程无关的泛化工作也要能建任务；非系统定义的任务默认不应与代码世界（分支/源码/端拆分）发生任何关系，除非任务 spec 显式声明要写代码

### 新增
- **开放类型系统**：任务类型从「内置 8 种封闭集合」变为「内置 + 用户自定义」——`.speccore/GLOBAL/TASK_TYPES/{类型名}.md` 声明自定义类型定义（label/category/outputDir/acceptance/needsBranch/constraints），`resolveTaskTypeDefinition` 按「内置 → 自定义定义文件 → 通用非代码回退」解析；init 生成 TASK_TYPES/README.md 引导文档
- **核心规则落地**：非系统定义的类型默认与代码世界绝缘（不建分支、不写源码、不需要端拆分与技术规格）；任务 spec 显式声明 `code: true`（或 needsCode: true / 行内「需要写代码: true」）才切换代码形态
- **needsBranch 声明**：TaskTypeDefinition 新增字段——doc/script/data/presentation 内置类型 needsBranch=false，execute 的 prepareTaskBranch 对非代码任务直接跳过分支创建（输出 ⏭️ 日志），spec code: true 可覆盖；chain prompt 明确标注「执行形态: 代码类/非代码类」
- **presentation 内置类型**（演示文稿/PPT）：产出 presentations/，验收「页数达标 + 每页标题与 3-5 要点 + 口播备注分离 + 无占位符」；内置 presentation-standards 约束（Markdown 大纲 + 逐页内容，渲染交给用户）
- **chain 开放类型调度**：移除未知类型硬过滤，自定义类型照常走链；spec code: true 时自动叠加 coding-standards 约束
- **task new 开放**：任意自定义类型允许创建（提示非代码形态），未知类型模板按「通用非代码」生成（frontmatter 带 type 声明）

### 变更
- `getTaskTypeDefinition` 未知类型回退从「feature」改为「通用非代码定义」（type 保留原名、builtin=false、needsBranch=false）；执行侧统一走异步 `resolveTaskTypeDefinition`
- TASK_TYPES / taskify 类型收敛 / verify 端目录识别同步扩展 presentation

### 测试
- taskchain.test.ts 新增 12 用例（presentation 断言 / 通用回退 / 自定义定义文件解析三态 / spec code 声明四种格式 / resolveTaskTypeDefinition 三级解析 / 自定义类型约束参与加载）；全量 398/398 通过

## v8.3.307 (2026-10-12) — TaskChain 泛化层：任务类型注册表 + 约束集 + 无人值守链命令

### 背景
- 长任务链场景：用户在迭代中混排「编码 / 写文档 / 写脚本 / 数据处理」等异质任务，部分任务共享共同前提约束，需无人值守逐个推进，且同类任务每次执行都要重新读取约束以重置上下文

### 新增
- **任务类型注册表**（task-type-registry.ts）：7 种任务类型单一事实来源——原有 4 种代码类型（feature/bugfix/refactor/research）语义不变，新增 doc（文档）/ script（脚本）/ data（数据处理）；每种类型声明产出目录、验收方式、分支类型、端子目录需求、默认约束集
- **约束集加载器**（constraint-set.ts）：「共同前提约束」声明式注入——任务 spec 中 `constraints: [a, b]`（frontmatter 数组/列表或行内三种格式）∪ 类型默认约束，每次执行前重新加载；约束文件位于 `.speccore/GLOBAL/CONSTRAINTS/{名}.md`，init 自动生成 5 个内置约束（coding/doc/script/data/research-standards）
- **chain 命令**（`speccore chain run/status/reset/constraints`）：无人值守任务链——拓扑排序逐个推进，每轮输出下一任务自包含 prompt（含重新加载的约束集），宿主 AI 执行后重复调用直至全部完成；状态文件 `.speccore/local/chain-state.json` 断点续跑，每任务开始/完成发通知
- **task new 扩展**：支持 --type doc/script/data（非法类型拒绝）；非代码类型按注册表裁剪（无端子目录，REQ.md 预写约束声明）
- **execute 约束注入**：runPromptMode 执行前按任务类型 + spec 声明重新加载约束集注入 prompt（重置上下文）
- **类型贯通**：TASK_TYPES / TASK_TYPE_TO_BRANCH_TYPE / taskify 类型收敛 / verify 端目录识别同步扩展 doc/script/data（doc → docs 分支）

### 测试
- taskchain.test.ts 18 用例（注册表 7 类型断言 / 约束声明三种格式解析 / 约束加载去重与缺失容忍 / 截断 / formatConstraints）；全量 385/385 通过
- 真实冒烟：init 生成 5 内置约束集 → task new --type doc/script/data 无端子目录 → chain run 注入约束集 → 宿主完成后 chain 汇总/status 正确 → --type 筛选与 constraints 列表正常

## v8.3.306 (2026-10-12) — 分支名与子任务 ID 一致性修复（去除重复类型段）

### 问题
- CONSTITUTION「任务分支: feature/{Task-ID}」中的 feature 是**分支类型段**，但解析端把它误存为 branchPrefix；taskify 生成 git-config 时又将其固化进「分支前缀: feature」，execute 拼接时 {type} 与 {prefix} 重复，产出 `feature/feature-Task-033-21-h5`——与子任务 ID（Task-033-21-h5）不一致

### 修复
- **解析端语义矫正**：CONSTITUTION「任务分支: X/」的标准类型名（feature/bugfix/hotfix/release/support/refactor/research）写入 branchType，自定义值兼容保留仍入 branchPrefix
- **拼接端去重兜底**：branchPrefix 与类型段相同时跳过（覆盖存量 git-config 固化值），统一抽取为纯函数 `composeBranchName`，主流程与 already-exists 重建端共用，消除重复实现
- **生成端**：buildGitConfigContent 不再把与类型段相同的值写入「分支前缀」
- **测试**：新增 git-branch-name.test.ts 8 用例（解析端矫正 / 拼接端去重 / 自定义前缀保留 / taskPrefix 路径 / 端到端存量兼容）；真实 git 冒烟验证 `feature/Task-033-21-h5` 落位

## v8.3.305 (2026-10-12) — 项目资产路径解析统一锚定项目根（子目录执行修复）

### 问题
- `.speccore/` 资产（PROJECT.yaml、CONSTITUTION.md、context.json、迭代目录、缓存/会话/环境）的路径大量硬编码为相对 cwd 或 `join(process.cwd(), '.speccore', ...)`——在项目任意子目录执行 CLI（如 AI 在 code_path 目录跑 execute）时整套规范数据库失联，表现 为「项目信息/端列表找不到」「未初始化」「PROJECT.yaml 不存在」等误判
- 已存在的 `findProjectRoot`（向上查找 .speccore/）只被 deploy/context 少数模块使用，配置层/git 层/命令层均未接入

### 修复
- **统一锚点**：task-utils 新增 `getProjectRoot()`；30+ 个文件的 `.speccore/` 资产路径（配置读写、CONSTITUTION、PROJECT_GRAPH、git-mapping、context、会话、缓存、RAG 索引、环境配置、code-graph、inbox、计划存储、迭代目录等）全部改为基于项目根解析，支持在任意子目录执行
- **惰性解析**：路径解析改为调用时求值（非模块加载时固化），兼容 chdir 场景（测试/多项目切换）
- **迭代目录统一**：task-utils 的 sync `getIterationDir`（24 个消费方）接入项目根，与 context.ts 的 async 版本行为一致
- **附带修复**：doctor 端列表检测对 `platforms: null` 兜底（无端配置项目不再报 Cannot read properties of null）
- **测试**：新增 project-root-resolution.test.ts（深层子目录下 getProjectRoot/getIterationDir/loadGitConfig 均命中项目根资产）；git-integration-subtask 夹具补 `.speccore` 锚点

## v8.3.304 (2026-10-10) — execute 拉分支接入 PROJECT.yaml 主配置

### 任务分支源解析链修复
- **问题**：execute 创建任务分支时只走 loadGitConfig（CONSTITUTION 文档声明 + 任务级 git-config），PROJECT.yaml 的 `git.default_base` 与 `git.branch_types[{type}].source` 从未参与判定——用户在主配置里声明 feature 从 develop 拉，实际仍从 main 拉
- **修复**：新增 `resolveTaskBaseBranch` 解析链：任务级 git-config「源分支」 > 迭代级 PROJECT_GRAPH「默认分支」 > PROJECT.yaml `branch_types[{type}].source` > `git.default_base` > git 检测回退；prepareTaskBranch 按任务类型逐一解析，并将解析结果传给 createTaskBranch（消除两处 checkout 不一致）
- **原始配置读取**：新增 `loadRawProjectConfig`（读磁盘原始 PROJECT.yaml，不 merge 默认值）——merge 后的配置含 DEFAULT_PROJECT_CONFIG 预置 branch_types 表，会把「用户没配 release」误判为「显式 source=develop」；只有用户显式声明才生效
- **测试**：git-branch-base.test.ts 锁定优先级链（6 用例）+ e2e 验证 feature→develop / hotfix→main / release→default_base

## v8.3.303 (2026-10-10) — 需求总纲退出自动生成 + unitize 默认发现端级文档

### doc2spec 转换
- **总纲不再自动生成**：删除 mergeToRequirement 自动合并（机械拼盘冒充总纲）；REQUIREMENT.md 改由用户按需经 synthesize 或 AI 生成；转换后提示语降级为「如需总纲请按需生成」
- **端名自动识别**：--platform 未显式指定时，从源文件名匹配 PROJECT.yaml 端列表（源文档按 {端名}.md 命名免传参数）
- **产物同名**：端文档产物与源文档同名（{端名}.md），源文档→转换→切分三段命名一条规则贯到底；无端文档回退 {源名}-requirements.md 不变

### unitize 切分
- **默认发现**：未指定 --file/--files 时自动扫描 converted/，按端名白名单（PROJECT.yaml platforms）匹配端级文档逐一切分——「切分本迭代需求」名副其实；旧命名 {端名}requirements.md 兼容命中不迁移；总纲与无端文档不进自动发现并列出提示
- **总纲拦截**：显式 --file REQUIREMENT.md 时拦截并指路（切分以端命名需求文档为准）
- **单文件/批量端名识别**：platform 未显式指定时从文件名自动识别（三个入口统一）

### 文档互链
- rewriteUnitLinks 候选补「{端名}.md 同名回退」——旧文档「{端名}requirements」互链在升级后不断链

### 配置升级（compile 截停根治）
- **截停根因**：v8.3.197 以 block_level 取代 quality_gates.compile，旧项目升级时 compile 被判「删除字段」→ 人工确认截停 → 新字段（verify_ui.devices/browsers/timeout/visual_model 等）永远补不上——同版本项目配置不一致即此因
- **修复**：新增 LEGACY_DROP_PATHS 已知废弃嵌套字段豁免清单 + filterLegacyRemoved 过滤 + deleteNestedKey 清理；compile 等已知废弃字段升级时自动移除、不截停；老项目重跑 `speccore config --upgrade` 即自动补全

### 示例配置对齐（templates + examples）
- **主配置示例重写**：speccore-yml-example.yml 与 DEFAULT_CONFIG 逐字段对齐——补 logging/tools/settings.pipeline/with_code/gates 等新字段；移除已迁移/废弃段（project/tech_stack/team/tests/stages/pipeline，旧段照抄会触发升级截停）；头部注明归属变化（tests 环境段 → .speccore/environments/{env}.yaml）
- **防漂移测试**：config-example-alignment.test.ts 双向锁定（added/removed 均须为空），DEFAULT_CONFIG 增减字段时自动提醒同步示例；templates 与 .speccore/examples 同源一致性一并锁定

## v8.3.302 (2026-10-08) — 负责人前置到单元级 + 单元级澄清触发

### 负责人前置（单元级 owner 声明）
- **_matrix.md owners 段**：unitize 写入空声明（`- platform / name / status`，pending 候选 / confirmed 已拍板）；analyze 端推断回填 platforms 后按 STAFFING 方向推导候选——方向唯一成员才写 pending，多人/无人报缺不脑补；confirmed 人工拍板优先保留、不被候选覆盖
- **OWNERS.md 视图**：analyze 确定性渲染 `020-specs/{单元}/overview/OWNERS.md`（端 × 负责人 × 状态表），供 SpecTest gen 阶段读取与人类审阅，改 _matrix.md 后重跑 analyze 刷新
- **taskify 升级**：autoAssign 从「负荷最低」升级为「单元声明 confirmed 优先、负荷均衡兜底」
- **新核心模块 src/core/unit-staffing.ts**：STAFFING 解析 / 方向匹配（全词边界 + 类别词别名：后台→backend/service、Web→h5/frontend、小程序→miniapp）/ owners 段读写合并

### 单元级澄清触发（替代全局专业度）
- **unitize 标记**：对需求原文切片做专业度检测，`_matrix.md` 写 `clarify: needed/optional`
- **analyze 按单元触发**：auto 模式只对标记 needed 的单元产出 CLARIFY.md（专业单元直接分析，缺什么补什么而非人人过关）；旧矩阵无标记时现场检测回填
- **Phase 0 提示单元范围**：澄清 Prompt 标注需澄清的单元清单，明示「未列出的单元无需澄清」

## v8.3.301 (2026-10-08) — global from-source 三件套强化：EARS 五句式 + 溯源锚点 + 验证环，ask 端名自动映射

### 反推需求链（global from-source）
- **EARS 五句式升级**：UR 验收标准从单一「当 X 时系统应 Y」升级为五种场景句式（普遍性/事件驱动/状态驱动/异常处理/可选特性），加两条反翻译腔硬约束（主语必须用户/业务对象、禁止函数名直译；必须带用户价值、禁止「输出 JSON」当验收标准）——压制「需求写得像代码翻译腔」
- **可追溯锚点**：IR 业务语义段加「溯源锚点」字段；UR 功能单元表加锚点列，每条验收标准必须带「溯源: `{端}/{模块}`」
- **验证环（--verify）**：新增 verifyReverseAnchors 确定性校验——REQUIREMENT.md 每条锚点与 IR 模块清单比对，悬空锚点（引用不存在的模块）即疑似 AI 幻觉，落盘 VERIFY_REPORT.md；REVERSE_PROMPT 加第三跳指引，global from-source 与 spec-from-source 均支持 --verify

### ask 意图识别
- **口语触发词扩充**：主词典 + extractParams 新增「按端反推/按端生成需求/根据端生成需求/生成需求文档/需求文档反推/代码生成需求/按模块反推/反推文档」等 12 个反推口语变体，不带「反推/逆向」字眼也能命中 global from-source
- **端名自动映射**：用户句中出现 PROJECT.yaml 端名/中文描述时自动补 `--platform <name>` + `--src <code_path>`（resolvePlatformFromInput 取最长端名命中防子串误伤，配置加载失败静默回退）
- **LLM 兜底补位**：intent-ai 占位兜底新增 global_reverse 意图（反推语义正则 + 建议命令），改变此前低置信度反推语料落入 help 的情况

### 文档
- DESIGN.md 七层机制小节补「源码反推需求链」设计说明（业界共识对照 + 三件套语义）
- help.ts / SKILL.md 同步 --verify 与端名自动映射说明

## v8.3.300 (2026-10-08) — 分支处理全链路体检修复：default_base/端级覆盖真正生效 + PROJECT.yaml 升级截停修复

### 修复（分支链路体检，本轮）
- **git.default_base 与端级覆盖零消费（核心 bug）**：getEffectiveGitConfig 死函数——类型/默认值/序列化器齐全但无调用方，用户改 default_base、platforms[].default_branch/branch_types 完全不生效；taskify 落盘子任务「源分支」只认全局 branch_types.source，兜底竟是 CONSTITUTION.md 旧值。修复：taskify 改用 getEffectiveGitConfig（端级合并）落盘，default_base 真正成为兜底锚点；补 platforms null 防御
- **pr.ts PR 目标分支硬编码 main**：三处 options.base || 'main' 从不读配置，注释却宣称 default_base 是「PR 合并目标」。修复：resolvePrBase() 回退读 PROJECT.yaml git.default_base
- **PROJECT.yaml protected_branches 不生效**：isProtectedBranch 只认 CONSTITUTION.md。修复：新增 getProtectedBranchesMerged/isProtectedBranchAsync（PROJECT.yaml 全局+端级为主源、CONSTITUTION.md 回退），pr/execute 四处切换
- **init 模板与解析正则不自洽**：CONSTITUTION.md 模板带 Markdown 加粗星号（「- **默认分支**:」），解析正则认不到——新 init 项目默认分支读不到、保护分支恒为空 → isProtectedBranch 恒 false，pr 会直接 push 保护分支。修复：模板去星号 + 解析正则行首锚定 + 双侧星号兼容（同时避开「> - **默认分支**：如 main...」字段说明行误匹配，防「如」字污染分支名）
- **谎报注释修正**：unified-config.ts「修改后运行 speccore update 自动同步到 CONSTITUTION.md」与 update 行为矛盾（update 明确保持不变），改为真实语义：PROJECT.yaml 是 Git 配置权威源

### 修复（配置升级，v8.3.299 累积）
- **PROJECT.yaml 升级被 project.description 截停**：早期 init 生成的 PROJECT.yaml 带 description/version，DEFAULT_PROJECT_CONFIG 未收录 → 判 removed → 截停 → git/code_scope 新字段永远补不上。修复：PROJECT_OPTIONAL_PATHS 白名单（project.description/project.version/verify）过滤 removed，用户值保留
- **verify 序列化器漏写**：ProjectConfig.verify 类型有（v8.3.58+）、DEFAULT 无、toProjectYaml 不输出——升级即丢。修复：toProjectYaml 补 verify 段（router_file）
- **default_branch 无条件输出 "undefined"**：旧 platforms 元素缺该字段时序列化器写盘字符串 "undefined"。修复：改条件输出
- **update 报告与行为不一致**：LEGACY 白名单只进 upgradeConfig，update 检查段与 checkAllUpgradeIssues 仍用原始 diff 误报「删除字段需确认」。修复：三处同步过滤

### 验证
- 构建 0 错误、291 测试全绿
- 5 项解析实证（星号格式/无星号格式/字段说明行防污染/表格行防污染/通配符语义）全过
- 「跑两次 upgrade 第二次无需升级」无假补全；旧项目带 description+verify 一次升级自动补全 git/code_scope 且用户值保留、无 "undefined" 写盘

## v8.3.298 (2026-09-29) — 旧版主配置升级截停修复：旧字段自动迁移，新字段补全不再卡壳

### 修复
- **旧版 .speccore.yml 升级被「需人工确认」截停（核心 bug）**：早期版本 platforms/git/code_scope/project 等字段存在主配置里（后来归属 PROJECT.yaml），升级时 detectConfigDiff 把它们判为 removed → requiresUserConfirmation 截停 → 只生成 upgrade-diff.md 不执行升级 → 用户配置里永远缺 logging/verify_ui 等新字段。修复：旧版顶层字段白名单（project/platforms/git/code_scope 自动迁移至 .speccore/PROJECT.yaml 缺失/空时回填不覆盖；tech_stack/team/conventions/error_codes 废弃删除），removed 过滤后不再阻断，升级全自动执行

### 验证
- 291 测试全绿；老格式复现：修复前截停（25 新增 + 6 删除需确认）→ 修复后一次升级完成，logging 注释块/verify_ui 段落盘、旧字段清零、platforms 完整迁移至 PROJECT.yaml（name 保留）

## v8.3.297 (2026-09-29) — vision 升级假补全修复 + 配置文档归属更正

### 修复
- **settings.vision 升级假补全（手写序列化器漏写）**：vision 字段类型（v8.3.94）与文档早有，但 DEFAULT_CONFIG 未收录、toConfigYaml 序列化器不输出——`config --upgrade` 反复声称「自动补全」而落盘即丢，用户配置里永远看不到 vision 段。修复：DEFAULT_CONFIG 补 vision 默认值（enabled: false / provider: qwen-vl / maxImagesPerPrompt: 10 / imageMaxSizeKb: 2048）+ 序列化器 review 段后补写 vision 输出（enabled/provider/model/apiKey/endpoint/timeout/maxImagesPerPrompt/imageMaxSizeKb）

### 文档
- **config-reference.md 归属更正**：§3.15 tests / §3.16 stages / §3.17 pipeline.test 标注「不属于 .speccore.yml 主配置，属于 .speccore/environments/{env}.yaml（模板 staging.yaml.example），写进主配置会被静默忽略」——此前照文档配置的用户字段不生效

### 验证
- 291 测试全绿；「跑两次 config --upgrade」验证：第一次补 vision 落盘、第二次显示无需升级（不再假补全）

## v8.3.296 (2026-09-29) — 部署配置/脚本示例补齐 + 配置示例家底盘点 + 引擎路径断链修复

### 新增
- **纯服务器 Nginx 站点模板** `templates/deploy-nginx/`：nginx-site.conf（SPA 回退/gzip/静态缓存/API 反代/WebSocket 升级/healthz 透传/HTTPS 占位，{{DOMAIN}}/{{APP_DIR}}/{{BACKEND_HOST}} 占位符）+ README——与 Docker 场景 nginx.conf 互补，补上「无容器直接装 Nginx」的缺口
- **Node 后端 Dockerfile** `templates/deploy-docker/backend-node.Dockerfile`：多阶段构建 + 非 root 运行 + HEALTHCHECK，与 frontend.Dockerfile/nginx.conf 组成完整前后端 Docker 示例
- **5 个缺失实体脚本** `templates/deploy-scripts/`：deploy-compose.sh / deploy-ftp.sh（lftp 直传）/ deploy-password-ssh.sh（sshpass 免交互）/ trigger-jenkins.sh（远程触发流水线）/ deploy-python.sh（venv+systemd）——set -euo pipefail + 密码 token 不落配置 + 缺失校验
- **主配置完整示例** `templates/speccore-yml-example.yml`（222 行）：覆盖 .speccore.yml 全部现行字段（quality_gates.block_level/verify_ui、arbitration、settings.vision/optional_steps/pipelines/ai/smoke 三时机、tests.auth、stages、pipeline.test），每段标注特性版本号；init 落地到 examples/config/SPECCORE-YML-EXAMPLE.yml
- **CI 示例落地链路**：templates/ci/github-actions.yml 此前「有文件无链路」——init 从未复制给用户，现同步到 examples/ci/，README 增第 11 条指引

### 修复
- **部署配置路径断链（核心 bug）**：engine.ts 的 script/pm2_config/manifest/values 路径只以端目录（cwd）为基准，而 init 生成的示例配置用项目根相对路径 .speccore/environments/scripts/...——端配 code_path 就断链（helm values 静默丢失 -f 最隐蔽）。新增导出 resolveConfigPath 双基准解析（优先 cwd、回退项目根 findProjectRoot），deployScript/deployK8s/deployHelm/deployPm2 四处改造

### 增强
- **deploy-examples.yaml 补 13/14/15 节**：nginx_site_example（ssh + remote_dir + reload 脚本）、go_systemd/go_docker、python_gunicorn——12 种场景扩到 15 种；脚本注释指向 templates/deploy-scripts/ 实体文件
- **VERIFY-EXAMPLE data-testid 对齐**：登录场景换三段式选择器（{模块}-{页面}-{元素}），补 tests.auth 自动登录注释（v8.3.215+）
- **config-reference.md §2 去双轨**：过时完整示例（停留 2026-08-28 老 schema，缺 8 个新字段）改为骨架速览 + 指向新模板
- **staging.yaml.example 与 update-env-configs.ts 同步**：auth 段补 data-testid 三段式约定注释

### 验证
- 291 测试全绿（285 + resolveConfigPath 6 用例）；npm pack 确认 deploy-scripts/、deploy-nginx/、backend-node.Dockerfile、speccore-yml-example.yml、ci/github-actions.yml 全部随包

## v8.3.295 (2026-09-29) — 静态资源发布链路修复：引导页链接 404 根治 + 防御加固

### 修复
- **onboarding 引导页关联页 404（核心 bug）**：`templates` 不在 package.json files 白名单，且 ask.ts/init.ts 两处模板读取用 `process.cwd()/templates/html`（用户项目根，永远不存在）——「升级后首次 ask 无引导页 + 页内四模式卡片/帮助链接全部 404」，setup-guide 亦长期走「模板缺失」降级页，连带 init 的部署/测试/规范示例复制（DEPLOY-EXAMPLE.yaml 等）全部静默失败。修复：files 加 `templates`；ask.ts 复制源与 init.ts setup-guide 模板源改为包内定位 `join(__dirname, '..', '..', 'templates', 'html')`（与 init 既有示例复制同源）
- **升级后首次 ask 不弹页诊断**：弹页开关 `.speccore/local/.ask-onboarded` 记录版本与 CLI 运行版本比对——全局 CLI 未升级（实测 8.3.282）而 marker 已是同版本时恒不弹；升级后需确认 `speccore --version` 或跑 `speccore init`（升级分支会重置 marker）

### 增强
- **generateFlowScenariosFromSpec 结构防御**：matchElement/matchPageSelector 补 `elementInfo.elements` 存在性与 `pageTestIds` 数组性判断，外部消费点传参不规则时优雅降级不抛 TypeError

### 验证
- 285 测试全绿；四轮专项验证（spec-generator 十项：表格提取/模板占位跳过/页面容器归类/stateDiagram 场景数与装配/preferPage 兜底/描述性箭头零误采/普通流程行/结构防御；status --group-by 分组视图；toSlug 复合命名底座；smoke-engine DOM 扫描五结构点）全 PASS
- 会议项目实测：修复后跑 ask，outputs/ 下 explain/guide/match/pipeline/help 五关联页全部落盘（修复前四页缺失）；`npm pack --dry-run` 确认发布包含全量 templates/html/*.html

## v8.3.294 (2026-09-29) — bugfix 复合命名 + 契约压进代码 + 冒烟 selector 自愈提示

### 增强
- **bugfix 任务目录名复合命名**：`buildTaskTopic` 拼「{模块英文}-{bug内容英文}」（如 Task-003-login-flow-timeout-crash），同一模块 bug 任务在 030-tasks/bugfix/ 下自然相邻；模块名优先 AI `moduleTopic`（prompt 层英译，仅接受合法 slug）、functionalUnit 走 toSlug 拼音兜底（v8.3.294 导出 toSlug）；bugSlug 已含模块前缀时防重复不叠加；模块段截 15 字符、总长受 40 字符上限约束
- **execute prompt data-testid 强制条款（两消费点同步）**：prompt-builder 前端实现要求与 execute.ts buildAgentContext 执行清单同步新增——「按 UI_SPEC.md 元素标识约定添加 data-testid（{模块}-{页面}-{元素}，页面容器 xxx-page 结尾），冒烟测试 VERIFY_SPEC 断言依赖这些属性」——补齐「拆分装配 selector → 执行落属性」链路的最后断链
- **冒烟 selector 自愈提示**：失败场景在页面仍可用时扫描 DOM 实际 data-testid 清单（SmokeResult.domTestIds，页面不可用静默跳过），runSmokeTest 汇总输出「selector 自愈提示」——列出失败场景页面的实际 testid 供修正 VERIFY_SPEC 占位 selector，不自动回写配置（防运行时误判）

### 文档
- DESIGN.md 新增附录「v8.3.291-295 冒烟装配四阶段时序设计 + bugfix 复合命名 + 静态资源发布链路」

### 验证
- 六分支验证：全英文复合（login-flow-timeout-crash）/拼音兜底/双拼音/防重复/无模块退化/feature 不受影响；构建 + 285 测试全绿

## v8.3.293 (2026-09-29) — 冒烟装配链三断链修复：元素清单提取 + 流程场景装配 + 无源码 Spec 通道

### 新增
- **UI_SPEC 元素清单提取 `extractElementTestIds`**：兼容三种写法（Markdown 表格含 testid 列任意左右位置 / 行内枚举 data-testid = a / b / 行内代码属性），模板占位（btn-edit-{id}）自动跳过，页面容器（xxx-page）单独归类 pageTestIds
- **流程场景装配 `generateFlowScenariosFromSpec`（v8.3.293 重写）**：三通道——①普通流程箭头行（A → B 步骤链）②mermaid stateDiagram 流转（含 `[*]` 初始伪状态与自环跳过）③描述性箭头零误采（视觉规范章节不误提取）；章节正则兼容中文序号（「## 五、交互状态」）；matchElement 双向包含 + token 分割匹配（「新增/编辑」→「新增按钮」）+ 最短元素名策略；初始流转 preferPage 兜底断言页面容器
- **无源码 Spec 通道 `generateSpecFromUiSpec`**：taskify 无源码时从 UI_SPEC/TEST 提取元素清单 + 业务流程，生成 VERIFY_SPEC 流程场景骨架——「分析阶段元素约定 → 冒烟配置自动装配」闭环

### 修复
- **流程场景为 0 的真因**：admin-web-04 UI_SPEC 交互流程是 mermaid stateDiagram 代码块且章节带中文序号，原提取器只认「业务流程」标题 + 普通箭头行——重写后 8 场景 3 真实装配（users-page/btn-add-user/dialog-disable）

### 验证
- 三通道验证：stateDiagram 装配 / 普通流程行 / h5 描述性箭头零误采；构建 + 285 测试全绿

## v8.3.292 (2026-09-29) — Git 配置修复 + 方案 A 逻辑分组视图

### 修复
- **extractValue 行首锚定**：解析正则加 `^` + m 标志，「前缀」不再误匹配「分支前缀: xxx」行（真实值行被注释前缀行吞掉）；无效占位值过滤
- **lifecycle 看板多根扫描**：只扫 030-tasks 根级，漏掉 030-tasks/{type}/（feature/bugfix/refactor）布局下的任务——collectTasks 补多根扫描

### 增强
- **status --group-by feature 逻辑分组视图**：按 `.meta/feature` 分组展示任务清单（模块统计 + 模块清单两段式），`--type bugfix` 自动启用分组视图；物理目录平铺不动（保住 CLI 多消费点固定层级扫描契约）
- **verify findTaskDir 布局兼容**：支持 030-tasks/{type}/ 与根级 Task-* 两种布局

### 验证
- git fixture 验证解析正确；会议项目 status --group-by feature 实测分组渲染正常；构建 + 285 测试全绿

## v8.3.291 (2026-09-29) — 任务依赖链根治：AI 依赖分析不再丢弃，plan 拓扑/分支合并依据打通

### 修复
- **taskify 阶段 dependencies 字段丢失（核心 bug）**：AI 返回的 `dependencies` 数组此前只用于日志展示，从未写入 `section._dependsOn`——导致 TASK.md「依赖任务」恒为「无」、plan 拓扑排期与 execute 依赖分支合并永远拿空数组（实测 /tmp 项目 3 任务声明 `Task-002/003 → Task-001` 落盘后全部变「无」）。修复：预分配任务 ID（与 1471 行非 response 模式对齐）+ 建立「AI 临时 id → 实际 taskId」映射 + 解析写入 `_dependsOn`；无法映射的引用保留原值（execute 阶段给出提示）
- **scanTasks 依赖硬编码空数组**：state.ts 三处 `dependencies: []` 从不读 TASK.md——新增 `parseDepsFromTaskMd` 解析「依赖任务」字段（兼容 `- **依赖任务**: Task-xxx` 与 `| 依赖任务 | Task-xxx |` 两种格式，逗号/顿号分隔、去重、过滤非 Task- 噪声），子任务级解析失败回退父任务级
- **findBranchByTaskId 父 ID 前缀匹配**：依赖以父任务 ID 引用（如 Task-002-f1-booking），而 git-mapping 精确匹配子任务 ID（Task-002-f1-booking-booking-service）——新增 `info.taskId.startsWith(taskId + '-')` 回退，跨仓库分支查找不再落空
- **--help/--version 退出码修复**：exitOverride 抛出的 commander.helpDisplayed/commander.version 未在 catch 中处理，落入兜底 exit 1（内容已正常输出，但脚本/管道会误判失败）——新增两码早退 exit 0

### 增强
- **IMPACT.md 输出「任务声明」依赖行**：`_dependsOn` 权威依赖最先列出（类型列标记「任务声明」），与 API 文本匹配/语义推断分层共存
- **任务总览表依赖列**：TASK_SUMMARY 从解析后的 `_dependsOn` 读取（此前用 AI 原始 dependencies 数组，ID 与落盘不一致）
- **端级分析模板补图表要求**：Phase 2 端级 TECH.md 骨架「写作要求」新增后端「核心接口调用时序图或数据模型 ER 图（Mermaid sequenceDiagram/erDiagram）」、前端「页面路由拓扑图（Mermaid graph）」；UI_SPEC.md 新增「核心页面交互状态流转图（Mermaid stateDiagram-v2，覆盖四态）」；QUALITY_RUBRICS 'UI_SPEC.md' checklist 同步补图检查项——修复功能单元分析文档几乎无图的问题（会议项目实测 mermaid 覆盖率仅 5.4%）

### 验证
- 285 测试全绿（新增 state-deps.test.ts 7 例：两种格式/多分隔符/无依赖/噪声过滤/去重）
- /tmp 项目端到端实测：taskify 解析 2 条依赖 → TASK.md「依赖任务: Task-002-f1-booking」→ scanTasks 读回 `["Task-002-f1-booking"]` → plan 拓扑分阶段（后端 Phase 1，两个前端 Phase 2 并行）+ Mermaid 依赖图正确渲染

## v8.3.290 (2026-09-28) — run 无参智能续跑 + 快捷语法糖：高频操作不再依赖 ask 引擎

### 新增
- **run 无参 = 智能续跑**：不带任何参数时按里程碑产物检测断点（需求导入/切分单元/分析/审计/任务化/计划/执行/验证/部署 9 个里程碑，谓词全部复用 PRECONDITIONS 与 analyze 既有检测函数），输出「智能续跑检测」面板（✅ 已完成/🔄 半途/⬜ 未执行 + 产物佐证）
- **四种状态分支**：无需求文档 → [SPECCORE_RESUME] 面板软停（exit 10）请用户选需求入口（导入 PRD / 一句话需求）；全新且有需求 → 不询问自动从 split-units 续跑至 pipeline；部分完成 → 面板软停问「①从断点继续 ②重新切分 ③自定义起止」（断点恰为 split-units 时 ② 与 ① 同义自动省略）；全部完成 → 指路收尾（run deliver / run docs）
- **hasRequirementDocs 提升模块级**：从 autoPipeline 闭包提升为模块级函数（参数化 iterDir），PRECONDITIONS 与智能续跑检测共用同一谓词
- **run 位置参数文法（语法糖）**：`run <preset名>` 直呼预设流水线（含自定义 pipelines.custom，优先于同名阶段别名）；`run <阶段/别名>` 单阶段快捷（从该阶段续跑至部署验证，如 `run smoke` / `run split`）；`run <from> to <to>` / `run <from>..<to>` 阶段范围（首 token 命中阶段/别名才解析，一句话需求如 "fix login to support OTP" 不误判）；`run <一句话需求>` 需求入口；`--demand` 逃生舱（需求恰为保留字时显式指定，跳过文法解析）
- **阶段别名表单一事实源**：新建 src/core/stage-aliases.ts（STAGE_ALIASES + resolveStageToken + parseRunRange + formatStageAliases + validateStageAliases 启动自检），别名 split→split-units、smoke→verify、deploy→pipeline、code→execute、tasks→taskify、ship→pr、archive→done、docs→spec2doc、import→doc2spec、req→req-doc；范围解析失败（首 token 命中但末 token 不命中）报错列别名表，不静默降级为一句话需求
- **analyze -g/--global**：快捷糖 ≡ speccore global analyze（Layer 1→4 自动推进）
- **unitize/doc2spec 文件位置参数**：`unitize 需求.md` / `doc2spec PRD.docx`（--file 兼容保留）
- **verify 位置参数**：`verify dev|pr|deploy|release` 直呼测试阶段（≡ --stage，非法值报错）

### 文档
- **spec-run SKILL.md + 6 份 agent 命令副本**（.claude/.codebuddy/.cursor/.trae/.trae-cn/.windsurf）同步补「智能续跑 + 位置参数文法」剧本：[SPECCORE_RESUME] 面 板 → 宿主 AI 用 AskUserQuestion 询问用户 → 用户选定后执行面板对应命令，未确认不 得自行续跑；run 文法形态直接拼命令不转 ask
- **run --help** 展示文法树与别名表（糖的悲剧是用户不知道有糖）
- **DESIGN.md 新增附录「v8.3.290+ run 智能续跑与快捷语法糖设计」**：里程碑谓词表/四分支决策/宿主 AI 接力协议/语法糖体系/设计原则（单一事实源/渐进解析/不静默降级/逃生舱/接力不擅自/启动自检）/修复记录/实测矩阵
- **README.md 核心流水线段**：「无参 = 智能续跑」+ 快捷语法糖示例；**docs/command-reference.md** run 章节补位置参数文法表与选项表；**AGENTS.md 常用命令速查**（含 init.ts 模板与 .speccore/RULES/03-COMMAND_CHEATSHEET.inline.md 注入源同步）补 run 快捷操作段
- **help 命令 run 详解**（src/commands/help.ts）补全位置参数文法/智能续跑/逃生舱参数与示例；templates/html/speccore-help.html 静态样例重生成；speccore-setup-guide.html 补智能续跑 + 语法糖提示

### 验证
- 278 测试全绿（无回归；一次性偶发失败三次重跑未复现）；端到端验证：会议项目 Iteration-014（部分完成，features 缺失）面板如实标注断点 split-units + exit 10；/tmp 空迭代无需求 → 需求入口面板；/tmp 全新有需求 → 自动续跑 split-units → pipeline（后续 unitize 闸口正常硬停拦截测试文档）；/tmp 全产物迭代 → 9 项全 ✅ + 🎉 指路收尾 + exit 0；run develop/smoke/split/verify/docs（preset 直呼/单阶段快捷/preset 优先于别名）/split to pipeline/split..split/split to xxx 报错/一句话需求不误判/--demand 逃生舱/unitize 位置参数/verify 非法与合法 stage 共 12 个形态逐一实测

## v8.3.289 (2026-09-28) — 任务名/单元标题英译链路贯通：宿主 AI 接力 + iter- 前缀根治

### 新增
- **task new 批量导入英译链路**：批量导入 bug 时一次 LLM 调用把全部「Bug 标题」英译为任务目录 slug（与 unitize/taskify 对齐）——宿主 AI 优先（无直连 LLM 且 ai.provider=host 或 auto_host_ai: true 时输出 [SPECCORE_PROMPT] 清单 + exitCode 10 接力，--translate-response '<JSON>' 续跑）；自配 LLM 兜底（providers 池 → 环境变量 → 本地 Ollama）；失败回退拼音。新增 --translate-en auto|host|off 与 --translate-response 选项
- **parseTranslationResponse 提升为共享工具**：从 doc2spec.ts 迁入 ask-llm.ts 导出（序号键/中文标题键/逐行正则三格式），unitize 单元标题与 task new 任务名两条链路共用

### 修复
- **iter- 前缀根治**：toSlug 拼音兜底自带 iter- 前缀（v8.3.286 遗留），被 nextTaskId/nextPlanId 复用后任务目录名变成 Task-001-iter-zhifuxiugai——去掉前缀；同时英文 slug 上限 20→40（toSlug 拉丁片段 30→40 + nextTaskId/nextPlanId 切片 20→40），LLM 英译长词不再截断（Task-001-booking-order-status-not-synced 完整保留）
- **unitize auto 模式消费 auto_host_ai**：此前 auto_host_ai: true 配置闲置，无 LLM 时静默拼音降级（会议项目日志实锤 yibiaopan）——现 auto 模式无 LLM 且宿主模式（ai.provider=host 或 auto_host_ai: true）时自动转宿主接力（清单 + exitCode 10），不再静默拼音；已携带 --translate-response 时不再二次接力（响应无效回退拼音，防接力死循环）

### 文档
- **spec-unitize SKILL.md 补英译接力剧本**：宿主 AI 收到 [SPECCORE_PROMPT] 翻译清单 → 逐条翻译 kebab-case slug（禁用拼音）→ --translate-response '<JSON>' 续跑（键=清单序号）；spec-task-create SKILL.md 同步补 task new 导入接力剧本

### 验证
- 新增 tests/unit/core/translation-response.test.ts（5 用例：序号键/中文键/带前缀文本/逐行正则/越界忽略）+ tests/unit/core/global-counters.test.ts（5 用例：拼音无 iter- 前缀/长英文 slug 不截断/中英混合提取/Plan/Iteration）
- 278 测试全绿（267 既有 + 11 新增）；端到端验证（会议项目）：批量导入无 LLM 接力 exit 10 → 宿主英译续跑 Task-270-booking-order-status-not-synced 等 10/10 创建；临时项目 unitize auto 接力 → 缓存命中 PRD-01-booking-management；--translate-en off 拼音兜底 Task-001-zhi-fu-hui-tiao-yi-chang（无 iter- 前缀）

## v8.3.288 (2026-09-28) — bug Excel 导入链路增强：端列识别 + 标准模板 + 模块筛选与精确统计

### 新增
- **Excel 端列识别与「所有端」展开**：excel-extract 新增 platforms 列模糊识别（涉及端/影响端/平台等）；task new 批量导入消费端列，「所有端/全部端/所有平台/all」别名展开为项目全部端，逗号分隔端名过滤项目端列表
- **title/desc 死代码复活**：导入任务名改用「Bug 标题」列（无则回退描述切片），描述列写入任务描述；列检测顺序调整（desc 先于 title）防「Bug 描述」被 /bug/i 抢当标题列
- **任务性质标明所属功能模块**：父任务 TASK.md 任务信息表加所属模块/涉及端/严重度行；bugfix REQ.md 头部属性表加类型/所属模块/涉及端/优先级/严重度；.meta/feature 锚点供筛选与统计
- **speccore task template**：导出标准 bug 导入模板 xlsx——Sheet1「bug-import」纯净表头（Bug 标题/Bug 描述/所属模块/涉及端/优先级/严重度/负责人/发现环境）+ Sheet2「说明」使用指南（示例行放 Sheet2 避免被导入误读）
- **execute --module 筛选**：按所属功能模块过滤待执行任务（匹配 .meta/feature 模糊包含），主执行路径与 --list-pending 均生效；执行计划 filters 快照同步
- **status/dashboard 模块统计**：终端面板与 HTML 看板新增「模块统计」段（按 feature 分组：任务数/完成/完成率/进度条）

### 修复
- **看板 bug 任务隐形**：dashboard HTML 导出与终端 status 此前只扫迭代根级 Task- 目录，task new 导入的 bug 任务（030-tasks/bugfix/ 布局）全部隐形——collectTasks 重构为多根扫描 + .meta 优先读状态/类型/模块
- **迭代名前缀重复**：context.json 存全名 Iteration-NNN，status/dashboard/health/lifecycle 视图再拼 Iteration- 前缀产生 Iteration-Iteration- 死路径——统一 resolveIterDir 归一化
- **多端子任务 id 冲突**：task new 为各端创建同名 Task-{id}-impl 子任务目录，scanTasks/topologicalSort 按 id 去重导致「所有端」展开后只剩 1 个执行单元——子任务目录名带端后缀（Task-{id}-{端}）
- **导出回退链断裂**：extractExcelTextOnly 引用不存在的 xlsx 库（package.json 仅 exceljs），文本提取回退永远返回 null——统一改为 exceljs 实现

### 验证
- 新增 tests/unit/core/excel-extract.test.ts（5 用例：列识别/英文列名/变体/缺列兜底/文本回退）
- 267 测试全绿（262 既有 + 5 新增）；端到端手工验证：模板生成 → 导入 2/2（任务名=标题列）→ .meta/REQ.md/TASK.md 模块属性 → 「所有端」展开 4 端 → execute --module 支付筛选 5→4 → status/HTML 看板模块统计精确呈现

## v8.3.287 (2026-09-28) — ask 意图引擎系统性根治（虚词归一化 + 锚点表体系化 +  回归基线）

### 修复
- **口语虚词隔断词组 trigger 全局根治**：v8.3.286 已修迭代创建场景，但「导入一下文档」「拆分一下任务」等同一类隔断在全表范围存在。新增 `normalizeInput` 预处理——剥离保守虚词表（一下/一个/帮我/请帮我/麻烦你/给我/一项/一条/一份，不剥「的/再/下/请」等歧义单字），匹配输入集合变为「原输入 + 归一化输入」双集合，每个 trigger/pattern 任一命中只计分一次（绝不双计）；参数提取仍用原输入，捕获组不受归一化污染
- **名词锚点表 ANCHOR_RULES 体系化**：v8.3.286 的迭代/项目/任务三处共现补丁是硬编码，现统一为 `{intent, anchors, verbs, bonus, guard}` 规则表在打分循环统一消费。迁移 286 三处（迭代 +35 排除「迭代的」定语、项目句尾宾语 +20、XX任务短语让位），新增：功能锚点（做一个/添加/实现 + 功能|模块|页面|接口|服务|系统 → create +20，修「做一个支付模块」被 execute 抢走）、文档锚点（导入/转换 + 文档|PRD|word|docx → doc2spec +25，修「导入一下文档」低置信度）、需求文档锚点（切分 + 需求文档|功能单元 → split-units +20）；短语让位提到 -40 以抵消功能锚点与上下文加成叠加
- **宽触发词降权**：trigger ≤2 字符（做/跑/开/检查/配置/设置等）计分 20→12，长词组保持 20——「做」不再轻松碾压「做一个」
- **迭代上下文加成补齐**：活跃迭代 +15 原仅限 execute/query_progress/review/change，现由 ITERATION_CONTEXT_INTENTS 集合（16 个迭代工作意图）统一享受；无活跃迭代 execute/query_progress -20 与全局分析豁免不变
- **重复 id 映射去重**：analyze×2、task new×2、welcome×2、dashboard×2 四对重复映射曾污染歧义展示，现按 (intent, command) 对去重——真重复只留最高分，不同意图共享命令名（task new/create、welcome/demo、dashboard/global_status）必须共存，避免 new_task 被 create 吞掉

### 验证
- **新增回归基线 tests/unit/core/intent-recognition.test.ts**（53 用例，真实 recognizeIntent 引擎，mock 上下文双模式）：固化两枪误判原话 + v8.3.286 验证过的 12 句 + 虚词隔断/宽 trigger 抢分/锚点让位/常规回归共 24 句核心语料 × 无迭代/有活跃迭代双场景
- 262 测试全绿（209 既有 + 53 新增）；两枪原话与 10 句新增误判句双场景手工验证 24/24 通过

## v8.3.286 (2026-09-28) — ask 迭代创建误判双枪修复 + 目录名 hash 乱码改拼音（会议项目实战反馈）

### 修复
- **「新建迭代」被识成 execute、「创建新迭代」被识成 task new**：三根因叠加——①词组 trigger「创建迭代/新建迭代」被口语虚词（「一个/个/新」）隔断只剩 pattern 分；②execute/create 的宽 trigger（「做/创建/新建」）+ 宽 pattern 拿 50 分基数再加活跃迭代上下文 +15，反超窄意图；③「迭代」锚点无专门加权。修复：iteration_create 补口语变体与英文 trigger（创建一个迭代/新建新迭代/iteration create 等）；新增「名词锚点共现加权」——句中出现迭代类名词（迭代/sprint/期次）+ 创建类动词即 +35（排除「XX迭代的功能模块」定语结构）；反向保护 create/new_task 宽 pattern 捕获迭代名词时 -35、明确「XX任务」短语时让位 -25；CONTEXT_RULES 补 iteration create 键（活跃迭代 +15，与 execute 对齐）。同构加固 init：「新建项目/创建一个项目」被宽「新建/创建」抢时由项目宾语共现夺回（「项目管理/项目计划」定语不误伤）。实测两枪原话均 100% 命中 iteration_create，12 组回归全绿
- **目录名 hash 乱码改拼音兜底**：`toSlug` 对纯中文名（无拉丁片段）用字符码和 hash 生成无语义乱码（「一个新迭代」→ `iter-cl0w`），目录名不可读——改用 pinyin-pro 全拼兜底（同一输入拼音稳定，幂等性不变）：「会议系统」→ `iter-hui-yi-xi-tong`；有 LLM 英译链路的 unitize/taskify 不受影响（仍走缓存→LLM→拼音三级）

### 验证
- 230 测试全绿；两枪原话 + 建任务/新建任务/执行/分析/新建项目/项目定语/sprint/口语开迭代等 12 组意图路由验证通过；toSlug 拼音/英文提取双路径验证通过

## v8.3.285 (2026-09-28) — 澄清报告实时汇总与语义宣导（会议项目澄清窗口补齐）

### 改进
- **CLARIFY_REPORT.md 升级为真汇总**：新增「待确认事项汇总」表——自动聚合两级 CLARIFY.md（全局 + 各单元）的全部待确认项（`- [ ]` 行），每项标注来源文件；总览同步待确认/已确认计数。此前报告只是源文档+产物清单，待确认项散落在 17 个 CLARIFY.md 里无汇总窗口
- **报告落点扩展**：`analyze --apply` 主通道收尾每轮刷新澄清报告（幂等：内容未变化跳过写入，mtime 不变），AI 接力写回的 CLARIFY.md 实时进入报告；此前报告仅在确认步骤兜底生成，auto 短路路径永远看不到澄清窗口
- **语义宣导段**：报告尾部新增「澄清机制说明」——两级 CLARIFY.md 即官方澄清产物（v8.3.181+）、黄金需求目录仅文档级澄清时生成（为空不代表澄清缺失）、auto 智能短路不等于澄清缺失

### 验证
- 会议项目隔离副本实测：11 条待确认全部聚合、来源标注准确、重复 apply 幂等（mtime 不变）、230 测试全绿

## v8.3.284 (2026-09-28) — 全局章节拦截内容回流修复（会议项目逐章对账）

### 修复
- **被拦截的全局章节内容凭空消失**：v8.3.268+ 语义拦截「核心业务规则（跨端通用）」等章节时只 `continue` 跳过切分，未将章节标题回流 `globalSections`——单元既不进 features 也不进 GLOBAL_CONTEXT，会议项目 PRD 5.3 的 R-RM/R-BK/R-FEE 共 17 条跨端核心规则在迭代产物中丢失（仅靠 AI 主动读源文件兜底）。现在拦截时回流 `unit.sourceSection` 标题，经 findSectionRange 切原文写入 GLOBAL_CONTEXT（隔离副本实测：章节数 12→13，17 条规则完整落盘）

## v8.3.283 (2026-09-28) — INDEX 幽灵行复活根因修复（会议项目重切验证）

### 修复
- **INDEX 幽灵行清理不彻底（v8.3.282 遗留）**：全局章节拦截只发生在目录创建循环，`units` 数组中仍残留被拦截的单元对象，随后 INDEX 写入循环将其重新写回——会议项目升级重切后「核心业务规则（跨端通用）」幽灵行复活。现在目录创建拦截、INDEX 旧行过滤、INDEX 新行写入三处共用同一判定 `isGlobalAnnotatedTitle`，幽灵行彻底清除（隔离副本实测：重切后 INDEX 16 行与 16 个单元目录一一对应，无残留）
- **unitize 跳过计数文案纠偏**：「跳过 X 个已存在」实际混入「已存在/重复切分/全局章节拦截」三类，改为中性「跳过 X 个」

## v8.3.282 (2026-09-28) — unitize 名称污染与 execute 骨架覆盖链修复（会议项目体检验证）

### 修复
- **unitize slug 剥离括号注释**：功能单元目录名生成时未剥离标题括号注释，「通知触发机制（跨页面通用）」→ `admin-web-09-tongzhichufajizhi-kuayemiantongyong`，说明性后缀污染目录名——现在 slug 只取主体「通知触发机制」（单元内容、INDEX 显示名不受影响）
- **INDEX 历史幽灵行清理**：features/INDEX.md 增量合并不删除已不存在的条目，被全局章节拦截（v8.3.268+）的「核心业务规则（跨端通用）」旧行永久残留——重切时按全局章节语义过滤旧行，幽灵条目不再保留
- **execute 单任务 prompt 补骨架覆盖指令**：SDK 派单路径的子 Agent prompt 从未要求覆盖骨架文件，且 STATE.md/ROUTES.md/COMPONENT_TREE.md/STYLE_GUIDE.md 的 `_待AI分析_`/AI-FILL 占位完全无下游覆盖指令（仅 REQ/TECH 有）——单任务 prompt 与 --agent 清单同步扩展，前端设计文档骨架纳入必覆盖范围

## v8.3.281 (2026-09-28) — execute 执行链路信息可见性修复（会议项目实战反馈）

### 修复
- **scanTasks 读 .meta/feature**：TaskState 新增 feature 字段（父任务与子任务均读，子任务优先回退父任务）——功能单元名是对齐锚点，此前 execute 上下文只有 slug 目录名，AI 被迫自己挖 .meta/feature 找真实单元名
- **--agent 上下文真实路径**：buildAgentContext 优先输出 scanTasks 记录的绝对路径（子任务 TASK.md、00-specs/REQ/TECH、_shared 契约、子任务级 REQ/TECH 骨架），不再让 AI 从 `Iteration-*` 通配符猜目录；Task 行直显功能单元名及对应 020-specs 规格源
- **SDK 派单降级原因上主通道**：execute 的 SDK 派单失败/TTY 降级原因此前仅 warn 到 stderr，外层 AI 主读 stdout 看不到，误以为派单成功，导致 prompt 无人消费的 exitCode 10 死锁——现在 finalOutput 头部输出 `[SPECCORE_SDK_FALLBACK]` 明确降级原因与落盘路径（--apply/--response）
- **--agent 帮助文本语义纠偏**：`External AI: ...` 让人误以为自动执行，实际只是打包上下文复制粘贴——改为「外部 AI 上下文打包」，并在输出中指路真正自动派单（execute --prompt 非 TTY 时自动 Qoder SDK 派子 Agent）

## v8.3.280 (2026-09-24) — dev 命令残留清理：文档与模板统一指向 run 流水线

### 修复
- **dev 命令残留清理**：`speccore dev`（智能级联）早已被 `speccore run` 端到端流水线取代（v8.3.190 已移除命令本体），但文档与技能描述仍残留 dev 引用——本轮统一清理：AGENTS.md（PIPELINE_REPORT.md 生成方改为 run）、.speccore/AI-RULES.md 命令表（dev 行改为 run 行）、spec-ask/spec-once/speccore-router 技能描述、六个编辑器斜杠命令 spec-ask.md、init.ts 的 AGENTS.md 与 TOOL_COMMANDS 模板（触发词 dev→run、删除 [SPECCORE_DEV] 标记行）、docs/DESIGN.md（删除 speccore-dev.html 页面清单行与 [SPECCORE_DEV] 标记行）

## v8.3.279 (2026-09-24) — 端推断自动填充 _matrix.md 声明

### 新增
- **端推断自动填充声明**（inferAndPersistFeaturePlatforms）：analyze 骨架生成前，对 platforms 声明为空的单元跑六层端推断（需求「涉及端」字段 1.0 → 目录结构 0.9 → 关键词 0.75），高置信度结果写回 `_matrix.md`（标注来源与置信度注释、可人工修改）并直接参与本轮骨架收敛——兑现 doc2spec「空数组由 analyze 端推断填充」的承诺（此前链路从未实现，空声明读了等于没读、收敛空转）
- **关键词推断多组命中取交集**：union 逻辑会让「通知+列表」这类常见组合膨胀成全端（收敛形同虚设），改为多组命中取交集、交集为空放弃推断走全端兜底——宁少勿滥，不瞎收敛
- **AI 填充引导**：骨架文件清单追加端声明核对指引（分析发现涉及端与 `_matrix.md` 不符时更新声明，重跑 analyze 即收敛）

### 修复
- 推断写回幂等：已声明单元不重复推断；重复写回时旧「推断来源」注释不叠加

## v8.3.278 (2026-09-24) — analyze 端覆盖矩阵收敛 + 未涉及端空骨架自动清理

### 新增
- **analyze 端覆盖矩阵收敛**：骨架生成按 `_matrix.md` 的 platforms 声明展开「单元 × 声明端」，替代旧「单元 × 全部端」笛卡尔积——单元只涉及部分端时，不再为未涉及端预建空骨架；声明为空/缺失的单元全端兜底（兼容旧迭代）。进度检测（detectSkeletonProgress）与骨架统计（countPlatformSkeletons）同口径收敛
- **未涉及端空骨架自动清理**（pruneUninvolvedPlatformSkeletons）：analyze 骨架生成后扫描 `020-specs/{单元}/`，声明外且目录内全部文件仍为 SKELETON 占位的端目录物理删除（清理 v8.3.277 及以前全端笛卡尔积残留）；已有真实内容的端目录保留并警告（防 _matrix.md 声明不完整时误删）
- **骨架生成日志可视化**：输出「📍 端覆盖矩阵收敛: 单元→[端,...]」逐单元可见收敛结果
- **unitize 英译降级提示**：无 LLM 环境拼音兜底时明示「⚙️ 未配置 LLM，N 个标题英译降级拼音」+ 指路两条拿英文名的路径（配置 SPECCORE_LLM_KEY 重切 / --translate-en host 接力），不再静默降级让人误以为没有英译步骤
- **换名重切同名检测**（unitize）：拼音→英文重切时目录名变了，走不到目录名命中、被内容指纹检测误拦「内容重复」卡死——新增「标题命中 + 指纹相同」两级同名检测，换名场景正确触发三选一（标题相同但内容不同的同名章节不误伤）

### 修复
- **备份目录第五处漏网**（spec-paths readFeatureDirs / feature-metadata 扫描器）：时间戳备份目录被 parseFeatureList 当功能单元，analyze 为旧目录再建全端骨架、FUNCTION_MAP 总览被假单元污染——两处扫描统一加 isTimestampBackup 过滤

### 修复
- **计数器 ENOENT**（global-counters）：save/initCounters 写前 ensureDir，修复 `.speccore/local/` 不存在时 taskify 首个任务即失败
- **异常静默吞没**（taskify）：response 路径 catch 以 `jsonParsed` 标志区分「JSON 解析失败（回退 Markdown）」与「创建过程异常（显式报错 + exitCode 1 + 备份清单提示）」，修复创建失败被冒充「✅ 任务已创建」
- **PROJECT_GRAPH ENOENT**（taskify）：updateProjectGraph 写前 ensureDir，修复全新迭代 `000-overview/` 不存在时拆分报错
- **幽灵后端子任务**（taskify）：`_explicitScope` 标记区分「AI 显式声明 scope」与「推断出的端」——AI 显式声明仅 admin-web 时不再被「确保至少有 backend 子任务」强制补后端，推断路径保留自动补后端
- **--modules 范围重建重复创建**（taskify）：创建循环按 functionalUnit 与模块列表匹配过滤，响应中非模块任务不再被重建（同模块新旧两份）
- **备份目录指纹隔离**：isTimestampBackup 正则扩展为 `-\d{14}(\.|$)` 同时识别文件与目录备份；doc2spec 幂等收集、taskify 模块驱动、analyze requirements 收集、readMatrixPlatforms 四处扫描点统一过滤——修复 overwrite 备份目录被当功能单元，污染指纹比对与单元清单、读到旧版 _matrix 过期端声明
- **docSlug 保留词避开**（doc2spec/unitize）：converted/ 下 `overview.md` 类文档名作前缀会让全部单元目录被「全局章节拦截」误杀，现 `overview/global` 前缀替换为 `doc`

## v8.3.276 (2026-09-24) — spec-once 使用说明响应协议

### 新增
- **spec-once 使用说明响应**：用户仅询问「怎么用/使用说明/使用步骤/能干什么」时不启动端到端流程，按 SKILL「使用说明」节输出纯文字指南（是什么/怎么触发/三入口/双模式/六步流程/回退重跑/适用边界），不执行任何 speccore 命令

## v8.3.275 (2026-09-24) — 步骤重跑体系 + spec-once 双模式

### 新增
- **unitize 同名单元三选一**（--on-duplicate ask|skip|overwrite|rename|abort）：TTY 交互三选一，非 TTY 默认 skip 保幂等；覆盖重建前旧目录整目录改名为时间戳备份（可回滚），重命名加 -2/-3 递增后缀且绕过内容指纹检测（用户已裁决，不被同名内容误拦）
- **taskify 指定范围重建**（--modules）：已有任务时只备份移除匹配模块的旧任务（.backup- 前缀改名，detectExistingTasks 不误收集），其余任务保留，替代 --force 全量推倒
- **spec-once 双模式**：默认人机交互（每节点确认）；用户说「全自动/别停」切全自动模式，仅范围确认/质量门禁失败/冒烟失败三个安全点停下
- **spec-once 部署收尾节点**：冒烟通过后接 speccore deploy 本地部署验证（默认不自动执行），形成「开发到部署」完整闭环
- **spec-once 步骤回退重跑协议**：重分析（analyze --unit 覆盖+备份）、重拆（taskify --modules）、重执行（execute 单任务）、重切（unitize --on-duplicate）四路径

### 修复
- 交互判定改用 stdin+stdout 双 TTY：仅 stdin 为 TTY 的管道环境（如 agent 终端）不再阻塞等输入
- 覆盖重建绕过指纹检测：修复「overwrite 删旧目录后重建被其它同名内容单元指纹误拦」导致的目录消失

## v8.3.274 (2026-09-24) — 翻译交互键约定统一（序号键一一对应）

### 修复
- **接力响应键约定统一**（doc2spec/unitize）：PROMPT 清单编号与 `--translate-response` JSON 键统一为序号（1~N 与标题一一对应，中文标题仅作展示）——修复「清单编号 vs 中文键」两套标识错位（AI 按序号回译会落空）与重复标题键冲突；解析器兼容序号键与中文标题键双格式。

## v8.3.273 (2026-09-24) — 翻译接力协议 + 任务层产物质量修复

### 新增
- **翻译接力协议**（doc2spec/unitize）：`--translate-en host` 模式无 LLM 环境时输出 `[SPECCORE_PROMPT]` 标题清单并 exitCode 10，宿主 AI 翻译后经 `--translate-response '<JSON>'` 写回缓存续跑（贴合 analyze 既有接力协议）；`auto` 保持全自动（无 LLM 拼音兜底不中断）。
- **完成门禁提示**（execute）：子任务标记完成时检测端级 REQ.md/TECH.md 若仍含 SPEC-SKELETON，警告宿主 AI 补写规格。

### 修复
- **TASK.md 联动**（execute）：标记完成时同步状态行「已完成」+ 工作清单全勾选（修复状态与 checklist 脱节）。
- **组级状态聚合**（execute）：Task 组全部子任务完成后，组级 .meta/status 自动同步 completed。
- **提取残留章节序号**（taskify）：extractSectionByKeywords 剥掉标题行，修复 COMPONENT_TREE/ROUTES/STATE/STYLE_GUIDE 开头残留「4. 组件拆分」类序号。
- **端类型感知**（analyze）：MONITOR/UI_SPEC 写作要求加硬约束——前端端禁写后端技术指标（SLF4J/Actuator），后端端禁写伪 UI 内容。
- **callViaWorkBuddy 注释谎言**（ask-llm）：修正「文件通信调宿主 AI」虚假注释（实际仅本地 Ollama 降级，宿主协作走 exitCode 10 接力）。
- **INDEX 状态列**（doc2spec）：无意义英文 draft 改为「待分析」。

## v8.3.272 (2026-09-24) — 单元标题 LLM 英译（拼音兜底 + 缓存幂等）

### 变更
- **LLM 批量英译**（doc2spec/unitize）：切分时调用 LLM 将单元标题译为英文 kebab-case 目录名（`admin-web-01-booking-management`）；复用 `callLlm` 三级降级（providers 池 → 环境变量 → WorkBuddy），失败/超时自动拼音兜底（v8.3.271 链路）。
- **翻译缓存**：映射落盘 `010-requirements/.unit-names.json`，重跑切分目录名稳定（幂等，LLM 翻译漂移不破坏对齐锚点）；翻译结果非法（非 ASCII/超长）自动回退拼音。
- **开关**：`--translate-en auto(默认) | off`（doc2spec 与 unitize 均已注册）；`--translate-en off` 或未配 LLM 时纯拼音命名。

## v8.3.271 (2026-09-24) — 功能单元目录名 ASCII 化（英文 slug + 中文元数据）

### 变更
- **单元目录名英文 slug**（doc2spec）：目录名尾段由中文标题改为英文 slug（`admin-web-01-预订管理` → `admin-web-01-yudingguanli`；英文/数字保留，中文转全拼，新增 pinyin-pro 依赖）。解决中文路径在 Windows/CI/Docker/URL 等场景的兼容风险，对齐任务层已纯 ASCII 的既有事实。
- **中文显示名不丢**：保留在 SOURCE.md 标题与 `_matrix.md` 的 `feature` 字段（FUNCTION_MAP 别名继续展示中文）。
- **兼容不迁移**：旧迭代中文目录名继续可用（对齐锚点按目录名匹配，不强制改名）；AGENTS.md/init.ts 补充命名规范说明。

## v8.3.270 (2026-09-24) — 「开新会话」指令残留清剿

### 修复
- **Skill 指令层清剿**：`.agents/skills/` 下 21 个 SKILL.md 仍在教宿主 AI「[SPECCORE_STEP_DONE] → 需开新会话继续」「[SPECCORE_CONTINUE] → 提示用户开新对话」，与 CLI 实际输出的「请在同一会话继续执行」矛盾——宿主 AI 遵从注入指令，把同会话接力改写成「请开新对话」。全部改为同会话优先，仅上下文紧张才开新会话。
- **taskify prompt 矛盾文案**：Pipeline prompt 前半句「提示你在新会话中执行下一步」与后半句「请在同一会话继续」自相矛盾，改为「输出 [SPECCORE_STEP_DONE] 标记与下一步命令」。
- **analyze 批次提示**：「请在新会话中逐个批次执行」改为同会话连续跑批次、上下文紧张才开新会话。

## v8.3.269 (2026-09-24) — 同义词组端名混淆修复 + 任务定位与数据容错

### 修复
- **findBestSpecMatch 归一化对称**：taskName 与 key 同样去除分隔符（-/_.）。此前含连字符的任务名（如 admin-web-02-会议室管理）第一层 includes 永不命中，端前缀精确匹配失效。
- **端标识拆组（synonyms.ts）**：`['frontend','web','h5','mobile','app','ui','前端','页面','移动端']` 把互斥端名当同义词，导致 admin-web 任务在 h5-mobile 文档键上刷出虚高 overlap 分，REQ.md 批量错位成「H5 首页」内容。拆为 frontend↔前端 / h5,mobile,app↔移动端 / ui↔页面 三组，'web' 不再与其他端词互刷。
- **findTaskDir 子任务 ID 直解**：父任务 ID 推断不再只截取前两段（Task-{seq}），改为最长前缀逐段递减匹配，多段任务组名（Task-{seq}-{端}-{序号}）的子任务 ID 可直接 -t 解析。
- **Python 数组字面量展开**：analyze 落盘的 `['| AC-01 | ...', ...]` 单行数组（AI 用 Python 生成未展开）在 taskify 提取时还原为多行表格，REQ.md 不再携带不可读字面量。

## v8.3.268 (2026-09-24) — 任务层六处断链修复（契约/端裁剪/文档分化/幽灵过滤）

> 会议项目任务层体检揭示的六个机制性断链一次性修复：execute 拿到空 API 契约、
> 每 Task 平铺全部端（68 子任务半数无中生有）、前端四份文档「一段多用」、
> 幽灵单元第五处漏网、overview 缺 DEPENDENCY_MAP、迭代路径双重前缀。
> 会议项目 taskify 重跑后：16 任务 × 3 端 = 48 子任务（收敛 20 个），
> 契约从 286 字节空壳变为含真接口的合并契约。

### 任务层断链修复
- **API 契约断链**（taskify）：`_shared/API_CONTRACT.yaml` 合并端级契约——全局契约空壳（`apis: []`）时，从 `020-specs/{feature}/{端}/API_CONTRACT.yaml` 收集真接口，多文档 `---` 分隔合并进 `_shared`；修复 execute 注入空契约、AI 无中生有发明接口
- **端覆盖裁剪**（taskify）：`_matrix.md` 显式声明优先；为空时从 020-specs 端级文档反推（仅当端级存在非骨架、≥200 字符的 TECH/TEST/UI_SPEC 才涉及该端）；修复 FUNCTION_MAP 列错位时静默回退全端平铺
- **FUNCTION_MAP 端列自适应**（taskify）：AI 落盘表格列错位（涉及端表头下是名称）时，扫描整行找「逗号分隔且 ≥2 个值全部属于标准端名」的单元格作端列；功能单元列改取 cells[0]（此前取 cells[1] 依赖旧数据列错位歪打正着）
- **前端四份文档分化**（taskify）：ROUTES/STATE/STYLE_GUIDE/COMPONENT_TREE 从 TECH 提取中按类型提取段落（extractSectionByKeywords：按 ### 标题切段匹配关键词），不再整段复制；提不到时回退类型模板

### 切分层
- **第五处幽灵过滤**（doc2spec）：标题括号注释为全局修饰词（跨端通用/全局/公共）且剥括号后是规则/说明/规范等容器词 → 拦截进 GLOBAL_CONTEXT（「计费规则」「签到窗口规则」等无注释的具体规则不受影响）

### 规格骨架与上下文
- **overview manifest 补 DEPENDENCY_MAP**（spec-skeleton）：PHASE1_INDEX_DOC_NAMES 增加功能依赖图，对齐 AGENTS.md 结构图
- **迭代路径归一化**（prompt-builder）：`resolveIterDirName` 兼容短名与 `Iteration-` 完整名，修复三重路径（020-specs/DESIGN、规格扫描、关联任务）双重前缀失效

### 验证
- 构建 ✅ + 全量测试 230/230 ✅
- 会议项目 taskify 实测：幽灵任务消失、16 Task 名称正确、端裁剪 48 子任务、契约合并 1540 字节含真接口、四份前端文档正文互异（diff 26/35 行）

## v8.3.267 (2026-09-24) — 幽灵目录清理 + 文档资产一等公民化（图片/原型优先注入）

> 会议项目实测驱动的两大战役：其一，切分与分析链路会把全局章节切成「幽灵目录」，
> 澄清文档写错位置导致内容“失踪”；其二，需求文档里的图片/原型等资产，
> 在上下文里只被当成附尾清单，AI 未必会看——本次将资产内容直接注入核心层，
> 与需求文本同为一等公民，预算紧张时正文截断让路、资产优先保留。

### 幽灵目录根因修复（v8.3.267）
- **扫描层三入口过滤**：`readFeatureDirs` / `extractIterationUnits` / `loadFeatureUnits` 统一过滤 `overview-` 前缀，杜绝「核心业务规则（跨端通用）」等全局章节被当成功能单元
- **切分层拦截**：`splitDocumentToUnits` 跳过 `overview-` 前缀章节（应进 GLOBAL_CONTEXT）
- **[CLARIFY:] 路由归一化**：AI 生成的澄清标记首段若为「overview」→ 归位全局 `overview/CLARIFY.md`；若非真实功能单元 → 路由到 `requirements/{slug}-clarified.md`（文档级黄金需求），不再落成幽灵目录

### 文档资产一等公民化（v8.3.267）
- **资产内容注入核心层**：图片/原型/互链与需求文本同级注入——HTML 原型 → Playwright accessibility tree 文本内联；图片 → 视觉模型描述内联（未配置则输出绝对路径 + 强提示打开查看）；SVG → 文本内联；MD 互链 → 标题大纲
- **资产优先截断**：核心层超预算时正文截断让路，资产块（原型内联 + 审计清单）优先保留，审计清单（短小、信息密度高）完整保留
- **断链告警**：`rewriteUnitLinks` 返回 `{content, broken}`，切分后三层匹配（`-requirements.md` 后缀/拼接/原始存档）仍不命中的链接显式告警，不再静默断链
- **提取层图片保留**：`extractIterationUnits` 500 字符截断外的图片引用行显式附加，不再静默丢失

### 执行链路修复（v8.3.265-v8.3.266）
- **v8.3.265**：execute 端平铺架构动态扫描（替代 legacy 10-/20- 前缀拼接）；并列最高分告警（通用词任务名命中多模块时不再静默取第一个错配文档）
- **v8.3.266**：Qoder SDK 派单链路——三级鉴权降级（QODER_PERSONAL_ACCESS_TOKEN 等）；失败 result subtype 不再误判为成功派单（修复调度循环空转耗尽单元尝试次数）；缺 PAT 给可操作指引；「工具不支持」与「支持但本次调度失败」区分；Qoder CN 会话识别

### 验证
- 构建 0 error；全量测试 230 passed（零回归）
- 会议项目 16 单元实测：13 个有资产单元截断后资产零丢失，3 个无资产单元正常截断无退化

---

## v8.3.239 (2026-09-22) — 任务类型体系收敛 + 任务文档体系修复（全链路体检驱动）

> 对切分→分析→任务层→执行层的文档来源与子 Agent 体系做了一次全链路体检，
> 修复任务文档的空洞断链（骨架填充、死提取、模板悬空命令），并完成 split → taskify 正名。

### 任务类型体系收敛（split → taskify 正名全链路）
- 子任务文档按任务类型裁剪（docSet 矩阵）：bugfix 轻量 5 份 / refactor 中等 9 份 / feature 全套 15 份；030-tasks 按类型分子目录（feature/bugfix/refactor/research）
- `split` → `taskify` 正名：ask-engine 意图表与流水线命令、AI-RULES 流程、prompts presets、HTML 引导页、文档引用全面同步；unitize 独立承接「切需求文档」语义
- 子任务清单补 REQ/TECH 骨架与 ADR.md；SCHEMA.md 标注改为「条件创建（涉及数据库变更时）」

### 任务文档体系修复（taskify）
- **SCHEMA.md DDL 提取链修复**：改 `findBestSpecMatch` 三层匹配（兼容 `{feature}/overview/TECH.md` 嵌套键），旧扁平键 `specContents['TECH.md']` 取不到 DDL
- **删除 REVIEW/DEPLOY 死提取分支**：分析层 9 份名单无此二文档、提取恒空，改走内容感知模板（generate 函数保留 material 参数，未来补提取源即可恢复）
- **material 阈值统一 10/30 → 200**：防止空模板被短垃圾材料覆盖（11 处：TEST/REVIEW/SCHEMA/DEPLOY/RISK/DEPS/MONITOR/COMPONENT_TREE/ROUTES/STATE/STYLE_GUIDE）
- **DEPLOY.md 模板悬空命令修正**：`speccore lifecycle --check` → `speccore verify`
- **API_CONTRACT.yaml 单一真相源**：全局契约已写入时不再被 section 提取版覆盖（保留 rate limit/幂等性/版本策略）

### execute
- 执行前必读清单加「用 Write 覆盖本端子任务目录下预建的 REQ.md/TECH.md 骨架（SKELETON_MARKER），写出专业规格，不得遗留骨架占位符」
- API 契约上下文路径修正：`00-specs/API_CONTRACT.yaml` → `_shared/API_CONTRACT.yaml`

### AGENTS.md / init.ts（结构图精简 + 悬空表重写）
- 悬空「来源：.agents/agents/ 的 spec-* 角色表」重写：唯一权威指向 `.speccore/AGENTS/_INDEX.md` + 流程×角色映射表（11 行）+ 23 个角色清单
- 迭代结构图精简 ~110 行 → 25 行三层骨架（000/010/020/030 各一行说清职责）+ 组织原则 + 快照声明（实际目录以 CLI 生成为准）
- 常用命令速查补 unitize/verify/pr；spec-skeleton 产物文案与 4 处注释旧术语统一（split → taskify、doc2spec --split → unitize）

### 验证
- 编译/构建通过；全量测试 216 passed / 14 failed（与基线一致，零回归）

---

## v8.3.238 (2026-09-22) — analyze Pipeline 闭环调度四连修（会议项目实测驱动）

> 会议项目（meeting-system，21 功能单元 × 4 端）全链路实测中暴露的 4 个流水线断点，
> 修复后 Pipeline 从「卡死/错位」恢复为「每步骨架填充完毕才推进、三通道统一推进」。

### 澄清层
- **骨架文件不视为已澄清**：`detectProfessionalLevel` 对含 `SPEC-SKELETON` 标记的内容直接判 low——修复「空骨架 CLARIFY.md 被当已澄清产物，专业度检测通过导致澄清被跳过」的循环

### 骨架预建（spec-skeleton）
- **死锁修复**：有功能模块的项目，全局 overview/ 只预建索引类骨架（`PHASE1_INDEX_DOC_NAMES`：FUNCTION_MAP/INTERACTION_MAP/PLATFORMS/CLARIFY/API_CONTRACT/ARCHITECTURE），内容类归 {feature}/overview/——此前预建 overview/REQUIREMENT.md 等骨架提示 AI 填充，但 --apply 按 v8.3.182+ 路由表拦截该路径，永远无法推进
- 新增 PLATFORMS.md 骨架（端列表文档，此前缺失导致 AI 无处填写端列表）

### apply 三通道统一推进（analyze）
- **Pipeline 推进抽取共享函数** `advancePipelineAfterApply`：JSON 多文档通道与 [DOC:] 多文档通道此前写入后提前 return，跳过尾部 Pipeline 推进（只有单文件模式能推进）；三通道统一调用（含 RAG 刷新 + 推进 + 状态输出）
- **单 [DOC:xxx] 文档写入修复**：`docBlocks.size > 0`（原 >1）——单个 [DOC:] 文档此前被错误落入单文件模式，把含标记的原文整体写入 ANALYSIS.md，目标文档反而没写
- **索引文档路由修复**：GLOBAL_SPEC_FILES 补 PLATFORMS.md/ARCHITECTURE.md/CLARIFY.md——此前 [DOC:PLATFORMS.md] 等被路由到 020-specs/ 根目录而非 overview/
- **apply 拦截条件化**：有功能模块的项目才拦截 overview/REQUIREMENT.md 直写（提示改由 split 聚合生成），无功能模块的老项目放行

### 步骤完成检查（Pipeline 引擎）
- **骨架完成检查** `getPendingStepSkeletons`：推进前检查当前步骤骨架是否全部填充（phase1-prompt 检查全局索引类、feature-{name}-prompt 检查该模块 overview 文档），未完成不推进并输出剩余骨架清单 + 当前步骤 Prompt——修复「单文档模式一次 apply 写 1 个就推进，剩余骨架错位到下一步骤」
- 功能模块 prompt 文档集与骨架预建清单对齐（去掉任务级文档残留 RISK/DEPS/REVIEW/MONITOR/DEV_GUIDE）

### 验证（会议项目实测）
- phase1-prompt 步骤：FUNCTION_MAP → INTERACTION_MAP → PLATFORMS → ARCHITECTURE 逐个 apply，检查逐次递减（4→3→2→1），全部填充后正确推进到 feature-REQUIREMENT-01-prompt
- 编译/构建通过，全量测试 216 passed / 14 failed（与基线一致，无回归；14 个失败均为旧目录结构过时用例）

---

## v8.3.235 (2026-09-22) — 切分碎片修复 + 澄清报告断链接线（会议项目实测驱动）

### 切分层（unitize/doc2spec --split）
- **碎片切分修复**：本地切分 `scanUnits` 新增「深度小节提升」——H4+ 叶子单元提升到最近祖先候选章节（修复端级文档「二、仪表盘(H3)」下的小节模板「2.1 用户场景/2.4 业务规则(H4)」被切成 20+ 独立单元的问题）
- **AI 切分截断修复**：`scanUnitsWithAI` 不再只传前 8000 字符（大文档后半章节 AI 看不到导致漏切），改为「全文标题大纲 + 正文前 30000 字符」
- 实测（会议项目真实文档）：admin-web.md 20+ 碎片 → 9 个功能单元；h5-mobile.md 20+ 碎片 → 7 个功能单元

### 澄清层
- **CLARIFY_REPORT.md 断链接线**：新增 `writeClarifyReport`（汇总源文档 → 澄清产物映射与完成状态），在 `buildConfirmCheckPrompt`（需求确认步骤）前自动生成——修复「报告无任何代码生成、确认步骤永远读不到」的断链

### 验证
- 编译通过，全量测试 216 passed / 14 failed（与基线一致，无回归）
- 会议项目（meeting-system）复现碎片 → 修复后重切验证功能单元干净

## v8.3.234 (2026-09-22) — 执行完成质量报告：成功/失败清单 + 产出物评分

### 质量报告（分析完成必出）
- 新增 `buildAndSaveQualityReport`：分析执行完成（调度循环汇总 / --auto-units / --resume-units 完成分支）时自动生成报告并落盘 `020-specs/QUALITY_AUDIT.md`
- 报告内容：成功/失败清单（每单元状态）+ 每份产出文档的 100 分制评分（复用 `validateContentQuality`：字数/必含章节/占位符残留/空表格/重复度五类扣分）+ 主要扣分项 + 失败单元修复命令（`--resume-units` 循环直到干净）
- 终端同步输出摘要（`📊 质量报告已落盘: ...（N 成功 / M 失败，平均 X 分）`）

### 验证
- 实测三态：有效单元（90 分，扣分项正确）/ 骨架单元（❌ 失败）/ 无文档单元（❌ 失败），报告格式与修复指引正确
- tsc/build 通过，全量测试 216 passed / 14 failed（与基线一致，无回归）

---

## v8.3.233 (2026-09-22) — 空骨架兜底闭环：检测→报告→定向重析→再检测

### 兜底闭环（针对「执行中断留空骨架」的最后一块）
- `detectPendingUnits` 纳入骨架检测：单元虽有完成记录，但 020-specs 落盘内容仍为 `<!-- SPEC-SKELETON -->`/空内容 → 仍视为待分析，`--resume-units`/`--auto-units` 会把有问题的单元重新捡起，直到干净
- `analyze --apply` 写入后质量报告增强：输出 `[SPECCORE_SKELETON_REPORT]` 结构化标记（宿主 AI 可感知）+ 问题文档清单 + 问题单元归类 + 兜底修复指引（`speccore analyze --resume-units -I <迭代>`，循环直到无空骨架）
- 调度循环 `maxRetries` 1→2：一轮内最多 3 次尝试（初始+2 重试），循环外 resume 还可无限续跑

### 验证
- 实测三用例：①完成记录+骨架内容→被重新捡起 ②完成记录+有效内容→视为完成 ③无完成记录→待分析，全部正确
- tsc/build 通过，全量测试 216 passed / 14 failed（与基线一致，无回归）

---

## v8.3.232 (2026-09-22) — spec-unitize skill 补齐 + 三个入口同步 + unitize 非 Markdown 拦截

### spec-unitize skill（与 spec-taskify 同款薄包装）
- 新增 `.agents/skills/spec-unitize/SKILL.md`：触发词（切分功能单元/单元化/切需求）与 spec-taskify 消歧（unitize 切需求→features/，taskify 拆任务→Task-*）
- description 写明 unitize 特有的四个前置校验点：输入格式路由（.md 直切、.docx/.pdf 先 doc2spec）、端名与 CONSTITUTION.md 端列表一致、重切覆盖语义、批量 --files

### 入口同步（此前 unitize 在宿主 AI 入口缺位）
- spec-ask description 命令清单：`split` → `unitize` + `taskify`（旧词清理）
- speccore-router：意图表新增「功能单元切分（unitize）」区块 + Prompt/Apply 映射表补 unitize 行 + description 概念清单补「需求切分（unitize）」
- 6 个 AI 工具目录（.claude/.cursor/.codebuddy/.windsurf/.trae/.trae-cn）补齐 `commands/spec-unitize.md` 斜杠命令

### CLI 增强
- `unitize` 对非 .md 输入直接报错指路（`unitize 只切分 Markdown → 💡 请先转换: speccore doc2spec --file=...`），不再把 .docx/.pdf 交给切分器裸切

### 验证
- 实测：`unitize --file fake.docx` 报错并指路 doc2spec 转换；tsc/build 通过；全量测试 216 passed / 14 failed（与基线一致，无回归）

---

## v8.3.231 (2026-09-22) — 移除 split 双名：拆任务唯一叫 taskify + ask 意图层补 unitize

### 命名归一（拆任务只保留一个名字）
- 移除顶层 `split` 命令别名——「切需求 unitize」与「拆任务 taskify」双动词明确分工，双名易混；旧脚本仍可用 `speccore iteration taskify`
- 4 个 AI 工具目录（.claude/.cursor/.codebuddy/.windsurf）的 `spec-split.md` 斜杠命令更名为 `spec-taskify.md`，废弃命令 `speccore split` 全部清理
- 帮助面板/命令文档/阶段命令推荐/下一步建议中的 split 命令名统一改为 taskify（`speccore split` 现报 unknown command）

### ask 意图识别层补 unitize（此前主意图匹配表缺条目）
- COMMAND_MAPPINGS 新增 unitize 意图条目（intent: split-units，priority 89）：「切分功能单元/切需求/单元化/切分xx文档」→ `speccore unitize`
- taskify 条目补充英文 trigger `split`：用户说「split」归一为 taskify（拆任务），不再与 unitize（切需求）混淆
- run 流水线阶段映射补 `unitize/unitz → split-units`，「从 unitize 开始跑」可识别
- STEP_SUBAGENT_MAP：unitize → product-analyst；split → taskify
- next-steps 新增 split-units 下一步指引（analyze → taskify）

### 验证
- 意图识别实测：切分功能单元→unitize / 拆分任务、split→taskify / unitize→unitize，全部正确
- `speccore split` 报 unknown command；`speccore taskify`、`speccore unitize` 均可用
- tsc/build 通过，全量测试 216 passed / 14 failed（与基线一致，无回归）

---

## v8.3.230 (2026-09-22) — code-index idx 别名补齐（与 AI 识别层一致）

### 别名一致性修复
- ask-engine 声明 code-index 别名 `['ci', 'idx']`，CLI 只注册了 `ci`，`speccore idx` 报 unknown command；补注册 `.alias('idx')`

---

## v8.3.229 (2026-09-22) — unitize 独立命令（切需求）与 taskify（拆任务）语义对称

### 切需求独立能力化
- 新增独立命令 `unitize`（别名 unitz）：切分需求文档（.md）→ 功能单元（features/），与「拆任务」taskify 命名对称、职责区分：
  - `speccore unitize --file converted/admin-web.md --iter <迭代> [--platform <端>]`：需求文档 → 功能单元（SOURCE.md 切片 + _matrix.md 类型/端矩阵）
  - `speccore taskify -I <迭代>`：功能单元 → 开发任务（Task-*，原 split 别名）
- 支持批量 `--files "a.md=端1,b.md"`；`--iter` 缺省读当前活跃迭代（context.json）
- `doc2spec --split` 保留兼容（描述标注「已拆出独立命令 unitize」）
- 帮助面板/命令知识库/AGENTS.md 速查表同步更新（核心流水线：init → doc2spec → unitize → analyze → taskify）

### 验证
- tsc/build 通过，全量测试基线一致（216 passed / 14 failed），无回归
- 会议系统实测：unitize 直接对 converted/admin-web.md 切分得到 9 个按文档顺序的功能单元

---

## v8.3.228 (2026-09-22) — 功能单元类型标记（feature/global-rule）+ analyze 读取内聚

### 单元类型判定（_matrix.md type 字段）
- 新增 `classifyUnitType` 确定性判定：父是规则容器（如 5.3 核心业务规则）→ global-rule；标题（剥括号后）以规则/策略/规范/机制/概览/模板/一览/字典结尾 → global-rule；其他 → feature
- type 写入 `_matrix.md`（feature | global-rule），feature-metadata 解析并供 analyze 识别「共享能力」与「端功能」
- 会议系统实测：三文档全部命中（8 页面功能 feature + 5 跨端规则 global-rule + 通知触发机制 global-rule），后续可被 AI/人工修正

### analyze 读取内聚
- 收集 features/*/SOURCE.md 时同步注入 _matrix.md（type/platforms/dependencies/apis），保证功能单元的外链元数据（类型/依赖/API 契约）一定被 AI 读到

### 验证
- tsc/build 通过，全量测试基线一致（216 passed / 14 failed），无回归

---

## v8.3.227 (2026-09-22) — 切分粒度回归功能级 + 功能单元目录按文档顺序

### 切分粒度：维度小节并入父功能（会议系统验证暴露）
- **问题**：`## 三、会议室管理` 下的 `### 3.1 用户场景`、`### 3.4 操作步骤` 等描述维度小节被切为独立功能单元（62 个碎片单元），功能级章节反而未切出
- **修复**：新增维度小节精确匹配集（用户场景/业务规则/异常场景处理/验收标准/字段说明/状态流转规则等 30+ 维度词）——维度小节随父功能合并，父功能章节成为单元（单元内容含全维度小节）
- **规则容器豁免**：`5.3 核心业务规则` 这类容器下的 `计费规则` 是功能单元而非维度小节，维度词在规则容器下豁免；容器判定剥离括号注释（`核心业务规则（跨端通用）`）
- **括号注释剥离**：`操作流程（预订完整流程）`、`二维码规范（业务层面）` 先剥括号再匹配维度词
- **全局上下文不重复收集**：父是功能单元的维度小节不再收集到 GLOBAL_CONTEXT（内容已在单元内）

### 功能单元目录按文档顺序
- 单元目录名加两位序号前缀 `{docSlug}-{NN}-{title}`（NN 按文档内章节顺序），文件系统排序 == 文档顺序，解决切分目录乱序问题

### 验证
- 会议系统实测：admin-web 16 碎片 → 9 功能单元（仪表盘/会议室管理/预订管理…按章节顺序）；h5-mobile → 7 单元（首页/快速预订/会议室详情/我的预订/消息中心/签到功能/移动端特有交互）；req-overview → 13 单元（F-01~F-08 + 5 跨端规则含计费规则）
- 单元 SOURCE.md 含全维度内容（3.1~3.7 子节），全局上下文仅收文档概述/验收标准汇总等真全局章节
- tsc/build 通过，全量测试基线一致（216 passed / 14 failed），无回归

---

## v8.3.226 (2026-09-22) — 切分质量修复 + 需求原文切片语义改名 SOURCE.md

### 切分质量修复（会议项目验证暴露）
- **跨文档重复切分防护**：内容指纹（sha1，剔除生成时间行）比对——REQUIREMENT.md 与 converted/overview.md 相同章节只切一次，跳过且不残留空壳目录（会议项目曾产出 13 对完全重复的单元）
- **UI 交互说明章节不再切为功能单元**：操作步骤/操作流程/页面布局/页面动效/手势操作/字段说明等章节归全局上下文（GLOBAL_CONTEXT），不再作为可开发的独立功能单元
- **单章节文档修复**：唯一最浅标题仅在存在更深标题时才视为文档标题，单个 H2 章节不再被整体误判跳过

### 语义命名
- 功能单元需求原文切片 `README.md` → `SOURCE.md`（语义「来源切片」）
- 新增 `core/feature-source.ts`：`resolveUnitSourcePath` 统一解析，优先 SOURCE.md，兼容旧迭代目录 README.md，无需迁移
- 13 个读取点全部切换（analyze/split/synthesize/units/spec-merger/feature-metadata/module-analyzer/requirement-clarifier/semantic-locator/handoff-generator/analyze-engine）+ AI prompt 文本与 AGENTS.md 同步更新

### 验证
- tsc/build 通过，全量测试基线一致（216 passed / 14 failed），无回归
- 实测：重复章节跳过、UI 章节归全局、SOURCE.md 写入、旧 README.md 兼容读取

---

## v8.3.225 (2026-09-22) — 端覆盖矩阵兜底 backend 污染端推断修复

### 问题根因
- run 流水线切分时 platformLabel 传空字符串，doc2spec 的 _matrix.md 兜底 `'  - backend'` 生效——会议项目 62 个功能单元全部标成非标准端名 backend（标准端名应为 booking-service/room-service/h5-mobile/admin-web）
- platform-inference Layer 2 读 matrix 时不做标准端名校验，直接以 0.95 置信度采信，端推断被全面误导

### 修复
- doc2spec：未指定端时写 `platforms: []`，交由 analyze 端推断（platform-inference）填充
- platform-inference：Layer 2 matrix 端名归一化到 CONSTITUTION 标准端名，全部非标准时不再误采信，降级下层推断

### 验证
- 会议项目旧数据实测：matrix 全标 backend 时正确降级为关键词推断（0.75 置信度 + 人工确认），不再被错误值短路
- 全量测试基线一致（216 passed / 14 failed），无回归

---

## v8.3.224 (2026-09-22) — 意图缓存版本感知修复（旧缓存固化错误识别）

### 问题根因
- ask 意图缓存（`.speccore/local/intent-cache.json`）无 CLI 版本感知：识别逻辑修复升级后，旧错误结果仍命中缓存永久生效
- ambiguous（歧义）是中间态，却被写入缓存固化——例如「从切分功能单元到开发，全自动执行」在 v8.3.195 前被误判为歧义并缓存（命中 14 次），runForced 修复后仍返回旧歧义结果

### 修复
- 缓存条目新增 `cliVersion` 字段（写入时记录 CLI 版本），查询时旧版本条目不再命中并惰性清除
- 缓存结构版本 1.1 → 1.2：旧缓存文件整体失效重建，一次性清除全部历史错误条目
- `cacheIntent` 拒绝缓存 ambiguous 结果（歧义不固化，每次重新识别）

### 验证
- meeting-system 实测：修复前命中旧缓存返回「歧义: run vs execute」，修复后正确识别 `speccore run --from split-units --to execute --gate auto` 并自动执行
- 全量测试基线一致（216 passed / 14 failed），无回归

---

## v8.3.223 (2026-09-22) — 闭环调度循环改造（方式 Y 宿主会话内闭环）

### analyze Pipeline 死代码复活
- `--pipeline` 选项此前从未在 cli.ts 注册（整个 Pipeline 模式是死代码）→ 已注册
- Pipeline 步骤模式从「输出 prompt 后退出」改为方式 Y 调度循环：AI provider 提前读取，llm/SDK 成功落盘后进程内 `advance()` 自动推进下一步
- 新增 `buildPipelineStepPrompt` 统一函数（初始化块与 --apply 推进块复用）与 `advanceToWorkStep` helper（自动跳过 `*-done` 纯检查步骤）
- 修复块 B 既有 bug：engine 创建未传 features/skipClarify 导致步骤链不一致跳错步骤；修复不存在的 `--resume` 选项
- 步骤隔离放宽为「同一会话继续」：`[SPECCORE_STEP_DONE]` 后宿主在同一会话执行 `speccore analyze --prompt --pipeline` 接力

### 各调度点方式 Y 闭环铺开
- plan.ts：graph 模式（任务 ≥5）补上 llm/SDK 调度闭环，新增 `savePlanToFile` 统一落盘；修复 `contextType` 非法字面量
- execute.ts：批次间 `[SPECCORE_CONTINUE]` 文案统一为「同一会话继续执行下一批次」
- change.ts：host 输出 prompt 后补上缺失的 `exitCode = 10`
- split.ts：接力文案统一为「同一会话继续」（PENDING 续批机制保留）
- 确认 execute batch-size 为确定性骨架生成（非 AI 调度点）、verify 为确定性校验，均无需循环化

### 验证
- 会议项目全流程实测：13 单元澄清循环 + 40 步 analyze Pipeline 完整跑通（含宿主接力/恢复/跳过检查步骤）
- 全量测试基线一致（216 passed / 14 failed），无回归

---

## v8.3.222 (2026-09-21) — 切分功能单元确定性修复（与 AI 解耦）

### 切分结果确定性
- split-units 阶段不再以「调用次数」判完成，改为统计 features/ **实际产出的功能单元目录数**
- features/ 未产出任何功能单元 → 硬停（`[SPECCORE_GATE] 切分功能单元失败`）
- 切分前统计需求文档 `##` 章节数，切分后产出数明显少于候选章节（<50%）→ 警告可能漏切

### 切分跳过感知
- taskify 阶段新增 features/ 未切分警告（`--from taskify` 跳过 split-units 时提示，任务可能粒度过粗）

---

## v8.3.221 (2026-09-21) — taskify 骨架硬闸口（堵住「空骨架拆垃圾任务」）

### taskify 骨架硬闸口
- run 流水线 taskify 阶段新增 `detectEmptySkeletonDocs` 检查：020-specs 仍含空骨架时硬停，防止 `--from taskify` 绕过 analyze 闸口后，AI 把「写作要求/质量标准」等骨架文字误当功能模块拆出垃圾任务（假完成）
- `preSplitGate` 的 REQUIREMENT.md、ANALYSIS.md 从 warn 升级为 block（taskify 拆分任务的核心需求上下文，骨架则无法拆分）

### 诊断结论（切分/analyze 断点根因）
- 切分（split-units）逻辑正常（scanUnits 正则能识别功能单元），meeting-system 的 features/ 未产出是「--from taskify 跳过了 split-units」，非切分 bug
- analyze 未落盘根因是 `settings.ai.provider: host`（仅宿主 AI，无自配 LLM）——analyze 在 host 模式依赖宿主 AI 逐文档 `--apply`，全自动流水线无法自动串起落盘循环

---

## v8.3.220 (2026-09-21) — 功能单元来源收敛 + FUNCTION_MAP 依赖降级

### 功能单元权威来源收敛
- 功能单元的权威来源统一为 `010-requirements/features/` 目录（doc2spec --split 产出），FUNCTION_MAP 降为「功能×端映射」参考
- split 的功能单元上下文回退链补 features/ 目录兜底：FUNCTION_MAP → ANALYSIS.md → features/ 目录（三者皆空才无清单）

### FUNCTION_MAP 依赖降级
- `preSplitGate` 的 FUNCTION_MAP 从 block 阻塞降为 warn 警告，缺失/骨架不再阻断 split
- 更新 purpose/impact 注释与骨架说明（「唯一依据」→「参考」）

### 路径 bug 修复
- 修复 2 处 ANALYSIS.md 回退路径漏 `overview/` 目录（`020-specs/ANALYSIS.md` → `020-specs/overview/ANALYSIS.md`），导致骨架场景回退读不到

---

## v8.3.219 (2026-09-21) — 冒烟体系文档沉淀 + 流水线示例补 verify

### 设计文档（docs/DESIGN.md）
- 新增附录章节「冒烟测试体系」：三时机（本地/部署前/部署后）× 范围（full/module）× 配置（settings.smoke）+ 单次 flag
- 覆盖 auth 登录配置、冒烟前自动装配账号、ask 冒烟消歧、测试约定职责归位（需求 vs Spec）等全部技术点

### 说明文档（README.md）
- 「质量验证」章节补充：auth 登录配置、settings.smoke 三时机开关、run/pipeline 单次 flag（--smoke/--skip-smoke/--scope）

### HTML 模板
- 修复 speccore-help / ask-pipeline / ask-guide 里 3 处过时 `speccore split` → `speccore iteration taskify`
- ask-pipeline（5→6 步）、ask-guide（8→9 步）流水线示例在 execute 后补 `verify`（本地冒烟）阶段

---

## v8.3.218 (2026-09-21) — 冒烟意图消歧 + 测试约定归位 Spec

### ask 冒烟节点消歧
- 冒烟不是独立流水线阶段，依附 verify（本地冒烟）/ pipeline（部署前/后冒烟）
- 阶段归一化：本地冒烟/开发完冒烟 → verify；环境冒烟/部署前冒烟/部署后冒烟 → pipeline
- preset develop 关键词补「开发完成/开发完/本地冒烟」，「开发完成，本地冒烟」→ develop（分析→验证）

### 测试约定职责归位（需求 vs 分析）
- 需求文档（PRD）只保留「测试账号」业务约定（账号名+角色），移除 data-testid/seed 等实现细节
- 分析文档（Spec）承载实现约定：TEST.md 骨架补「测试账号约定」，UI_SPEC.md 骨架补「元素标识（data-testid）约定」
- extractTestAccountHint 扫描优先级改为 Spec（020-specs）优先

---

## v8.3.217 (2026-09-21) — 冒烟三时机 × 范围统一设计

### 冒烟测试统一配置（settings.smoke）
- 新增 `settings.smoke` 配置：三时机开关（points.local/pre-deploy/post-deploy）+ 范围（scope）+ 按环境差异化（scope_by_env）
- 三时机对应常规开发流程：①本地冒烟（开发完、提交前）→ ②部署前冒烟（critical 阻断）→ ③环境冒烟（只报告）
- 范围两级：full=全量 / module=当前功能模块（diff 变更级后续）；可按环境差异化（如 production→full、dev→module）

### 三时机接入
- `run` 流水线 verify 阶段接入 points.local 开关 + scope（本地冒烟默认 auto）
- `pipeline` test 阶段接入 points.pre-deploy/post-deploy 开关（build-check 不受冒烟开关影响）

### 单次控制 flag
- `speccore run` / `speccore pipeline` 新增 `--smoke`（强制）/ `--skip-smoke`（跳过）/ `--scope full|module`（单次范围）

### 文档
- config-reference 补 settings.smoke 字段详解

---

## v8.3.216 (2026-09-21) — 冒烟前自动装配登录账号 + 流程级冒烟骨架

### 冒烟前自动装配登录账号（解决「init 时账号还没定」的时序矛盾）
- 账号填充时机从「init 占位」改为「开发完成、即将冒烟」的时间点自动装配，不再要求 init 时就填死账号密码
- 新增 `describeAuthResolution`：冒烟前解析账号/密码来源（环境变量 > 明文 > 需求文档「测试账号」章节），生成「改了什么/缺什么」清单，自动模式同样打印告知用户
- 新增 `extractTestAccountHint`：从需求/Spec 文档「测试账号」章节自动提取账号名（email 优先）
- 装配结果仅内存生效（不落盘、密码不进 git），账号未就绪时冒烟登录自动降级跳过，不阻断页面可达性检查

### 业务流程冒烟骨架自动生成
- `generateFlowScenariosFromSpec`：从需求/Spec 文档「业务流程」章节提取含 `→` 的流程步骤，生成流程级场景骨架（导航 + data-testid 占位断言），精确 fill/click 由 AI/人工补充

### 文档
- testing-guide 补流程级场景骨架生成说明

---

## v8.3.215 (2026-09-21) — 冒烟测试登录账号配置 + 开发完成后自动冒烟

### 冒烟测试登录账号配置（auth）
- 新增 `auth` 测试登录配置：冒烟/视觉测试执行前自动登录，登录态在所有场景间共享
- 支持凭据来源双模式：环境变量引用（`username_env`/`password_env`，推荐，密码不落库）+ 明文兜底
- 可配置登录页、账号/密码/提交按钮选择器、登录成功判定（URL 含片段 / 元素出现）
- 配置位置：测试场景文件（`.speccore/tests/*.yaml`）或环境配置（`.speccore/environments/*.yaml` 的 `tests.auth`），测试配置优先级更高
- 首次开发项目的账号来源约定：PRD 定义测试账号 → 后端 seed 脚本创建默认账号 → 环境配置引用

### 开发完成后自动冒烟
- `run` 流水线 verify 阶段在代码验证（编译+Lint+单测）后，若存在 `.speccore/tests/smoke.yaml` 自动追加 UI 冒烟（local 环境优先，失败降级为 warning 不阻断）

### 元素标识规范
- 文档新增 data-testid 命名规范（`{模块}-{页面}-{元素}`），业务流程验证依赖稳定元素标识
- 环境配置模板（`update-env-configs`）补 `tests.auth` 字段，新项目 init 即带登录配置

### 文档
- testing-guide.md 新增 §4.5 登录账号配置 + §4.6 元素标识规范
- config-reference.md 补 `tests.auth` / `tests.local_urls` 字段详解

---

## v8.3.193 (2026-09-19) — 命令名彻底改名 iteration taskify

### 命令名彻底改名
- `iteration split` 命令名彻底改为 `iteration taskify`（不再保留 split 过渡 alias）
- 同步更新：run.ts 流水线 cmd/execSync、intent 识别 id、ask 知识库、help/error-diagnosis/doctor/init 提示、docs 文档（9 处 `speccore split` → `speccore iteration taskify`）
- ask 识别「拆分任务」→ `iteration taskify`；「从拆分到开发」→ `run --from taskify`；「从切分功能单元到开发」→ `run --from split-units`（两概念彻底区分）

### 仓库同步
- 新增 GitHub 远程 `github`（windfallsheng/SpecCore.git），与 gitee 双远程同步

---

## v8.3.191 (2026-09-19) — ask 流水线编排 + 命名根治 + 端类型统一

### ask 自然语言编排流水线
- run 流水线意图：识别 preset 名（部署/交付/全流程/开发流程等）+ 起止点（"从 X 到 Y"）
- 口语阶段名归一化：部署→pipeline、提交→pr、切分功能单元→split-units、拆分/任务化→taskify
- run 意图带 preset/起止点时优先编排（runForced 跳过歧义检测与中置信度确认）
- 新增 spec preset（doc2spec→taskify，导入需求→任务化生成 Spec）

### 命名根治：拆分任务 split → taskify
- 「切分功能单元」（split-units）与「拆分任务」（split）命名混淆，拆分任务阶段 key 改为 taskify
- 命令 iteration split 保留（加 alias taskify 过渡），流水线 key/ask 归一化/handoff/闸口/preset 全部切 taskify

### 端类型判定统一
- 新增 resolvePlatformType 统一入口，优先级：PROJECT.yaml type > CONSTITUTION.md 端列表 > 目录名正则兜底
- 消除 analyze/spec-skeleton 多处硬编码正则判定与两层判定不一致

### 切分与澄清职责分离
- 切分功能单元独立成流水线步骤（split-units），澄清纯化（req-doc 不再自己切分）

### 命令审计与文档完善
- 命令审计：3 组重叠命令标注层级（status/progress/dashboard、done/archive/retro、impact/merge-check/diff）
- help 首页突出常用命令 10 个，弱化完整命令数
- README/文档修正过时命令数量（26+/20）与 dev 命令残留
- HTML 模板清理（6 个死模板）
- config-reference 补 optional_steps 三态开关 + pipelines 命名流水线
- analyze --from-code 暴露 --out-dir 指定反推需求产出目录

## v8.3.190 (2026-09-19) — 澄清三态开关 + 命名流水线 + js-yaml 根治

### 澄清语义重构与三态开关

- **clarify 改名 req-doc**：澄清语义重新归属，消除「澄清=需求文档化」歧义
- **澄清三态开关**：`optional_steps.clarify` 支持 `auto`（按专业度判定）/ `on`（强制）/ `off`（跳过）
- **三层覆盖**：命令 flag（`--clarify`/`--skip-clarify`）> ask 意图 > 配置 `optional_steps` > 默认 `auto`
- **质量报告解耦**：7 维度审查（`assessRequirementQuality`）无论澄清模式都生成 `QUALITY_REPORT.md` 留痕，跳过澄清也有报告

### 流水线重构与命名流水线

- **dev 拆分为 run + next**：`run`=唯一执行入口，`next`=进度指引（阶段检测 + 下一步 + 闸口提醒）
- **命名流水线体系**：`init` 移出流水线；内置 preset（`full`/`import`/`analyze`/`develop`/`deliver`/`deploy`/`docs`）；用户自定义 + 默认（`settings.pipelines`）
- **默认流水线收窄**：`pr`/`done`/`spec2doc` 为独立收尾操作，默认 `develop`（analyze→verify）
- **plan 单任务跳过**：Task ≤ 1 跳过 plan，多任务才列计划
- **optional_steps 扩展**：clarify/verify/pipeline/pr/done/spec2doc 六个非必要步骤可配置

### 配置解析根治

- **parseYaml 换 js-yaml**：根治「回读不对称」——flow 数组、列表占位项 `- # 注释`、空数组 `[]` 三类序列化 bug 一次性解决（读用 js-yaml、写保留手写注释）

### 意图识别与 subagent 修复

- 复合意图「分析+拆分」正确进入 pipeline 编排
- 端级/功能级 subagent 映射缺口修复（`requirement-analyzer-admin-web` 等归一化映射）
- req-doc 补 subagent 调度

## v8.3.188 (2026-09-19) — 配置升级链路修复与诊断增强

### 配置升级链路修复（5 个缺陷）

- **`detectConfigDiffFromFile`**：新增读磁盘原始 YAML 检测缺失字段（`loadConfigWithMeta` 深度合并补全会掩盖缺失，导致 `detectConfigDiff` 永远看不到磁盘缺的新字段）
- **`upgradeConfig`/`upgradeProjectConfig` 提前返回修复**：不再因 schema_version 匹配 + warnings 空就提前返回，改用 fileDiff 判断，同版本缺失字段也能补全
- **toYaml 数组序列化改用块级写法**：flow 写法 `['desktop']` 自定义 parseYaml 不认识，回读成字符串导致 `devices.map` 崩溃；新增 `normalizeStringArray` 兼容历史脏数据
- **toYaml `pipeline`/`with_code` 缩进修复**：原 4 空格误嵌套进 `review`，改为 2 空格
- **toYaml `schema_version` 取消注释**：原被注释导致 validateConfig 持续报「必须是数字」

### 诊断增强

- **`doctor` 规范库一致性检查**：从「只查目录存在性」升级为「对比内置 defaults 清单」，能发现缺失的内置文件（如新增 agent / `_INDEX`），给出补全建议
- **`update` 版本过旧警告**：检测「项目初始化版本 > 当前 CLI 版本」时警告 CLI 过旧，提示先升级 CLI 再执行 upgrade

## v8.3.187 (2026-09-19) — 诚实降级体系与工程加固

### 通用行为准则优化（4 → 7 条）

- **`prompt-builder.ts` 抽取 `UNIVERSAL_BEHAVIOR_RULES` 常量**：原 4 条硬编码准则扩展为 7 条，融合业界最佳实践
  - 新增「先读后写」「最小改动」「主动澄清」「破坏性操作先确认」
  - 「不假装确定」合并进「降级到诚实」，升级为「事实/推断/猜测」三档置信度
  - 依据：Claude Code 官方系统提示词、Anthropic Prompt Library、Karpathy 12 规则

### 死代码清理

- 删除 8 个零引用命令文件（2009 行）：backup/context/current/global-status/health/import/lifecycle/status
- 删除 `understandIntent` + `synthesizeIntent` 死代码（321 行，askEngine 才是 ask 主入口）

### 功能接线（A 类孤儿模块）

- **`refresh` 接入 `detectStaleGlobalDocs`**：刷新后检测全局文档过期（≥1 天才报告），提示增量重建
- **`search --global` 接入 `searchGlobalKnowledge`**：全局层 RAG+图谱语义检索，区别于关键词搜索
- **`dev` 接入 `generateHandoff`**：13 阶段流水线关键阶段成功后生成阶段交接摘要（13→6 阶段映射）

### bug 修复（meeting-system 实测）

- **`config --project` 选项缺失**：cli.ts 补注册 `--project`，修复 doctor 提示的升级命令报 unknown option
- **`detectConfigDiff` 开放式字典误判**：`git.branch_types` 等 Record 字段不再误报用户自定义键为 removed
- **`detectStaleGlobalDocs` 过期 0 天噪音**：只报告过期 ≥1 天的文档
- **版本比较误报**：about/update 改用 semver 比较，不再把旧版本（如 v8.3.161 < 182）误报为「新版本」

---

## v8.3.182 (2026-09-18) — 文档路由显式化与白名单精细化

### 文档路由表（r4）

- **`analyze.ts` `DOC_ROUTING` 常量**：在代码中显式定义每类文档的归属路径
  - 索引类 → `overview/`（FUNCTION_MAP.md / INTERACTION_MAP.md / PLATFORMS.md / CLARIFY.md / API_CONTRACT.yaml）
  - 内容类 → `{feature}/overview/`（REQUIREMENT.md / ANALYSIS.md / TECH.md / RISK.md / DEPS.md / REVIEW.md / MONITOR.md / DEV_GUIDE.md）
- **迭代层 prompt 新增「文档路由表」章节**：以 Markdown 表格形式明确每类文档的路由目标、文档类型和说明
- **明确 ANALYSIS.md 归属**：属于内容类，严禁放在 `020-specs/overview/` 下

### 白名单分两级（r3）

- **`prompt-builder.ts` 白名单重构**：从单一白名单改为「核心白名单 + 条件白名单」两级结构
  - 核心白名单（CORE_EXTRA_FILES）：CONTEXT.md、ERROR_CODES.md（所有任务都加载）
  - 条件白名单（getPlatformExtraFiles）：按平台类型动态加载（backend → SCHEMA.md；frontend → COMPONENT_TREE.md / ROUTES.md / STATE.md）
- 白名单外文件统一收集后输出 `console.warn` 提示

### 预算调整与报错优化（r5）

- **`CONSTITUTION.md` 预算从 4000 放宽到 6000 字**
- **报错提示优化**：超限报错时给出具体的精简建议（删除过时注释、链接外部文档、使用表格等）

### 模块澄清自动引入全局澄清（r1）

- **`analyze.ts` 上下文加载逻辑**：加载模块澄清时，自动检测并确保全局澄清 `020-specs/overview/CLARIFY.md` 在最前面

---

## v8.3.181 (2026-09-18) — 架构细化与上下文控制加固

### 澄清产出位置：两级澄清结构（f1）

- **`hasValidClarifiedDocs` 修复严重 bug**：删除错误的 `return false;`，恢复 source 更新检测逻辑
- **`analyze.ts` clarify 标记写入逻辑**：支持新路径格式 `[CLARIFY:overview/CLARIFY.md]` 和 `[CLARIFY:{feature}/overview/CLARIFY.md]`，兼容旧格式 `[CLARIFY:requirements/xxx.md]`
- **`analyze.ts` 需求澄清验证**：改用 `hasValidClarifiedDocs()` 统一检测（支持两级路径 + 旧路径兼容）
- **`analyze.ts` 上下文加载**：优先加载 `020-specs/overview/CLARIFY.md`（全局）和 `020-specs/{feature}/overview/CLARIFY.md`（模块），其次兼容旧路径
- **`analyze.ts` prompt 更新**：Phase 0 clarify prompt 和 confirm prompt 中的路径说明更新为新格式
- **`AGENTS.md` 项目结构**：明确 `020-specs/overview/`（索引类）和 `020-specs/{feature}/overview/`（内容类）的职能边界

### 子任务文件白名单（f2）

- **`prompt-builder.ts` `scanUserCustomFiles`**：从“无差别扫描”改为“白名单模式”
- 只加载 `ALLOWED_EXTRA_FILES` 白名单内的文件（SCHEMA.md, TEST.md, REVIEW.md 等）
- 白名单外文件被忽略并输出提示

### 按文件类型细分预算（f4）

- **`prompt-builder.ts` `FILE_BUDGETS`**：按文件类型设置不同预算上限
  - 必须完整（报错不截断）：CONSTITUTION.md(4000), REQ.md(2000), API_CONTRACT.yaml(2000)
  - 可以截断（截断+警告）：TASK.md(1500), TECH.md(3000), DEV_GUIDE.md(2000), 其他(1000)
- **`loadExtraSpecs`** 和 **`loadAllTaskContext`** 中均使用细分预算
- 兜底模式预算放宽到 2 倍

---

## v8.3.180 (2026-09-17) — 文档同步更新

### 设计文档全面同步 v8.3.177-179 架构变更

- **`docs/DESIGN.md` 新增 §1.5.18 上下文控制架构**：
  - 元数据基础设施（`_matrix.md` + `feature-metadata.ts`）
  - 总览两阶段生成（skeleton → full）
  - 计划阶段 CLI 算图（`plan-graph.ts`）
  - 执行阶段只传契约规则 + 阅读清单模式
  - 跨阶段上下文传递（Handoff）+ 会话边界

- **`docs/DESIGN.md` Agent 阶段表**：新增 `overview-skeleton`（6K）和 `overview-full`（8K）

- **`docs/overview.md` 核心流程图**：`analyze → split` 改为 `analyze(overview) → analyze(功能单元) → split`

- **`docs/command-reference.md`**：补充 `analyze --scope=overview --phase=skeleton|full` 和 `plan --prompt` CLI 算图说明

- **`docs/task-directory-design.md`**：功能单元标识章节补充 `_matrix.md` 说明

- **`AGENTS.md` 项目结构**：`features/{feature}/` 下新增 `_matrix.md`

- **`README.md`**：同步更新核心流程图和目录结构

---

## v8.3.179 (2026-09-17) — 兜底模式上下文控制修复

### 修复 `loadAllTaskContext` 过量加载关联任务文档

- **关联任务只传契约**（`src/core/prompt-builder.ts`）：
  - 之前：从知识图谱获取依赖任务后，读取关联任务 `00-specs/` 下**所有 .md 文件**（REQ.md/TECH.md/DEV_GUIDE.md 等）
  - 之后：只读取关联任务的 `API_CONTRACT.yaml`（优先 `_shared/`，回退 `00-specs/`）
  - 上下文减少：关联任务从可能数千行 → 最多 400 行契约

- **020-specs 端规格改为阅读清单**（`src/core/prompt-builder.ts`）：
  - 之前：兜底模式下直接加载 `020-specs/{feature}/{platform}/` 下所有 .md 文件全文
  - 之后：改为阅读清单模式，只列文件路径和 feature 名，不加载全文
  - 避免兜底模式下加载过多其他 feature 的端规格导致上下文爆炸

---

## v8.3.178 (2026-09-17) — 计划阶段 CLI 算图 + 执行阶段只传契约

### 计划阶段增强（上下文控制）

- **新增 `src/core/plan-graph.ts`**：CLI 算图模块
  - `buildPlanGraph()`：扫描任务 → 构建依赖图 → 拓扑排序 → 关键路径
  - `computeBatches()`：按依赖关系分层为执行批次
  - `findCriticalPath()`：计算耗时最长的依赖链
  - `detectResourceConflicts()`：检测同一人在同一批次的资源冲突
  - `generatePlanJson()`：生成 100-200 行结构化 JSON

- **增强 `speccore plan --prompt`**：
  - 任务数 >= 5 时，自动启用 CLI 算图模式
  - CLI 先算图（依赖图、批次、关键路径、冲突检测）
  - 输出结构化 JSON 给 AI，AI 只做判断（优先级冲突、资源冲突、风险）
  - 上下文从 3000+ 行（任务文档）→ 100-200 行（JSON 元数据）

### 执行阶段增强（只传契约，不传实现）

- **修改 `speccore execute --prompt` 的上下文加载**：
  - 同一 Task 的其他端：只加载 `API_CONTRACT.yaml`，不再加载 `REQ.md`/`TECH.md`
  - 上游依赖任务：只加载 `_shared/API_CONTRACT.yaml`（契约），不加载需求文档
  - 本 Task 的共享契约：保持加载 `_shared/API_CONTRACT.yaml`
  - 每个子任务上下文控制在 500-600 行，不累积

### 核心设计原则

- **计划阶段**：CLI 做确定性计算（图算法），AI 做判断（冲突、风险）
- **执行阶段**：只传接口契约，不传代码实现
- **任务间传递**：`API_CONTRACT.yaml` 是唯一的跨任务信息载体

## v8.3.177 (2026-09-17) — 元数据扫描 + 总览生成（上下文控制核心）

### 功能单元元数据基础设施

- **新增 `_matrix.md`**：每个功能单元自动生成端覆盖矩阵
  - 记录 `platforms`（涉及端）、`dependencies`（依赖）、`apis`（接口）
  - 由 `doc2spec --split` 自动创建，支持后续人工调整
  - 作为总览生成的唯一元数据来源

- **新增 `src/core/feature-metadata.ts`**：元数据扫描器
  - `scanFeatureMetadata()`：扫描 `features/` 目录，读取每个单元的 `_matrix.md`
  - `extractSummary()`：只读 `README.md` 前 2 句，不读全文
  - `calculatePlatformCoverage()`：计算端覆盖统计
  - `findCrossFeatureApis()`：识别被多个功能引用的接口

### 总览生成（两阶段）

- **新增 `speccore analyze --scope=overview`**：
  - `--phase=skeleton`（默认）：生成骨架总览
    - 功能地图（Mermaid 依赖图）
    - 端覆盖总览表
    - 功能单元清单确认
    - 输出控制在 40-60 行
  - `--phase=full`：生成完整总览
    - 系统架构图（服务拓扑 + 数据流）
    - 跨功能单元接口清单
    - 实际依赖关系表
    - 输出控制在 60-80 行

- **支持 `--apply` 接收 AI 结果**：自动解析 `[DOC:OVERVIEW]` / `[DOC:ARCHITECTURE]` 标记，写入 `020-specs/overview/`

### 核心设计原则

- 总览只处理 **50-80 行 JSON 元数据**，不碰功能单元完整内容
- CLI 做确定性提取（扫描 `_matrix.md`），AI 做理解性生成（写描述 + 画图）
- 总览是 **关系图 + 索引**，不是内容汇总

## v8.3.176 (2026-09-17) — 功能单元拆分 + 变更追踪 + Handoff 传递摘要

### 功能单元拆分（P2-11 上下文控制基础）

- **新增 `doc2spec --split`**：转换文档后自动按 `##` 标题结构拆分为功能单元
  - 扫描标题结构识别功能单元边界
  - 过滤非功能章节（附录、术语表等）
  - 每个单元写入 `features/{unit}/README.md`
  - 生成 `.meta/source` 来源标记
  - 生成 `features/INDEX.md` 单元索引

### 功能单元管理

- **新增 `speccore units` 命令**：
  - `units --list`：列出所有功能单元（含状态、来源）
  - `units --edit <单元>`：查看单元内容摘要
  - `units --merge "A,B"`：合并多个单元，原单元标记 deprecated
  - `units --delete <单元>`：删除单元（备份到 `.trash/`）

### 变更追踪

- **每个功能单元支持变更履历**：
  - `CHANGELOG.md`：记录每次变更的类型、说明、时间
  - `.meta/versions/`：每次变更前自动备份旧版本
  - 合并/删除操作自动记录变更历史

### Handoff 传递摘要生成器

- **新增 `src/core/handoff-generator.ts`**：
  - `generateHandoff(from, to, iteration)`：阶段完成后生成传递摘要
  - 支持 analyze→split / split→plan / plan→execute / execute→review / review→done
  - 摘要存储在 `.speccore/local/handoffs/`（不提交 Git）
  - 篇幅限制：analyze→split ≤60 行，plan→execute ≤150 行

---

## v8.3.175 (2026-09-16) — 全面清理历史兼容性代码

### 清理目标

- **移除所有版本号注释**：代码中不再出现 `vX.Y.Z+:` 格式的版本标记
- **移除向后兼容描述**：所有"向后兼容""旧版""旧格式""旧结构""旧路径""旧布局"等描述统一清理为当前态表述
- **删除向后兼容命令**：`arch-update`（已合并到 `update --arch`）
- **删除迁移指南**：`docs/migration-guide.md` / `docs/migration-guide.en.md`（无历史包袱，无需迁移）
- **精简 CHANGELOG**：只保留 v8.3.169 及之后的近期版本
- **删除旧 RELEASE 文件**：`RELEASE-v6.89.0.md` / `RELEASE-v8.3.46.md`

### 影响范围

- `src/cli.ts` — 删除版本注释 + 删除 `arch-update` 命令 + 清理 welcome panel 旧路径回退
- `src/commands/` — 清理 analyze.ts / execute.ts / split.ts / change.ts / synthesize.ts / update.ts / init.ts 等文件中的版本注释和向后兼容逻辑
- `src/core/` — 清理 spec-paths.ts / prompt-builder.ts / state.ts / knowledge-graph.ts / verify-engine.ts / task-paths.ts / git-integration.ts 等文件
- `docs/` — 删除 migration-guide.md / migration-guide.en.md
- `RELEASE-*.md` — 删除 v6.89.0 和 v8.3.46 的发布说明

---

## v8.3.174 (2026-09-16) — P1 概念收敛：质量门禁分层 + Subagent 重命名 + 模式参数收敛 + 文档拆分

### P1-4: Subagent 重命名 — SessionAgent 标记统一

- 全局替换 `[SPECCORE_SUBAGENT]` → `[SPECCORE_SESSION_AGENT]`（Headless 标记模式对应 SessionAgent 概念）
- 更新 `agent-adapter.ts` 标记输出、`AGENTS.md` 标记说明
- 保留代码内部变量名不变（内部实现细节）

### P1-5: 分析策略统一

- 新文档 `ARCHITECTURE.md` 只保留三层分析理论模型
- 四层扫描/流式分析合并到 Pipeline 阶段描述中

### P1-6: 模式参数收敛 — 配置优先

- **`execute.ts`**: `strict` / `pipeline` / `withCode` 未传入时从 `.speccore.yml` 读取
- **`unified-config.ts`**: `settings` 新增 `pipeline?: boolean` 和 `with_code?: boolean` 配置项
- CLI `--strict` / `--pipeline` / `--with-code` 保留（向后兼容），配置文件可设置默认值

### P1-7: 质量门禁分层 — 默认4项 + 严格模式12项

- **`verify-engine.ts`**: `runQualityGate()` 新增 `strict?: boolean` 参数
- 默认执行 4 项关键检查：编译检查（阻塞）、单元测试、API 契约合规、规格文档质量
- `strict=true` 时附加 12 项：Lint、依赖完整性、安全扫描、Spec 一致性、DEV_GUIDE 合规、Schema 一致性、测试用例覆盖、评审项合规、部署清单、错误码一致性、知识图谱依赖一致性、代码文件非空
- **`execute.ts`**: 两处 `runQualityGate` 调用传入 `strict: options.strict`
- **`conflict-detector.ts`**: `detectConflicts` 签名更新，支持 `strict` 透传

### P1-8: 配置文件收敛

- `.speccore.yml` 的 `settings` 段扩展：支持 `pipeline` / `with_code` / `validation.strict_mode`
- 模式参数默认值从 CLI 移入配置文件（CLI 仍可覆盖）

### P1-9: 文档拆分

- 新增 `docs/ARCHITECTURE.md`（~205 行）：核心架构当前态（全局组织 + 规范数据库 + 迭代目录 + 命名规范）
- 新增 `docs/COMMANDS.md`（~135 行）：命令参考（流水线 + 速查 + 标记体系）
- `DESIGN.md`（6214 行）保留为历史完整设计文档

---

## v8.3.173 (2026-09-16) — P0 架构收敛：路径回退消除 + 防乱写机制精简

### P0-1: 路径收敛 — 删除所有回退分支

- **`spec-paths.ts`**: `resolveGlobalSpecPath()` 删除 `global/` 和根目录回退，只保留 `overview/`
- **`knowledge-graph.ts`**: 删除 `020-specs/platforms/{端}/` 旧路径兼容扫描
- **`analyze.ts`**: 删除 `docs['FUNCTION_MAP.md'] || docs['overview/'] || docs['global/']` 三重回退
- **`analyze.ts`**: 删除 `sanitizeSpecDirectories` 自动调用（保留函数作为后续 `speccore migrate` 工具）
- **`split.ts`**: 删除 `specContents['DEV_GUIDE.md'] || specContents['overview/DEV_GUIDE.md']` 回退
- **`audit.ts`**: 删除 `apiMap['overview/'] || apiMap['global/'] || apiMap['REQUIREMENT.md']` 三重回退
- **`spec-skeleton.ts`**: 删除旧结构兼容（无功能模块前缀的 platform 文档）
- **`prompt-builder.ts`**: 删除根目录 `.md` 文件读取回退，只读 `overview/`
- **`state.ts`**: 删除迭代根目录旧布局兼容（`030-tasks/` 不存在时回退到迭代根目录）

### P0-2: 防乱写机制收敛 — 简化 Prompt 路径约束

- **`analyze.ts`**: 简化路径提示，从 "不要创建目录 + 写入正确路径 + 不要绕过 --apply" 收敛为 "文件已预创建，只覆盖已有文件"
- **`split.ts`**: 简化 "⚠️ 绝对禁止" 段落为 "⚠️ 约束"，合并路径约束为单条指令

---

## v8.3.171 (2026-09-16) — 补全遗漏项 + SDK 优化

### 补全：change 命令集成 SDK 调度

- **change.ts `--prompt` 模式**：补上 `[SPECCORE_SUBAGENT: impact-analyst]` 标记 + `dispatchSubagent` SDK 调度尝试
- 统一触发条件：非 TTY + Qoder 环境
- 统一失败回退：自动回退到 Prompt 模式

### 优化：Qoder SDK 适配层

- **`buildQoderAgentDefinition` tools 字段**：新增 `'Agent'` 工具，支持子 Agent 递归调度
- **`mapToQoderAgentName` 映射表扩展**：覆盖 SpecCore 核心子 Agent（spec-analyzer、spec-executor、task-decomposer、schedule-planner、impact-analyst、code-reviewer、security-reviewer）→ Qoder 内置 Agent
- **`dispatchSubagent` 单例优化**：QoderSdkAdapter 实例复用，避免每次调用重复动态 import SDK

---

## v8.3.170 (2026-09-16) — SDK 调度覆盖全部 Prompt 模式命令

### 扩展：全部 Prompt 模式命令集成 SDK 调度

- **`execute`**: `runPromptMode` 末尾集成 `dispatchSubagent`，支持 `spec-executor` / `spec-executor-{platform}` 子 Agent SDK 调度
- **`split`**: `--prompt` 模式集成 `dispatchSubagent`，支持 `task-decomposer` 子 Agent SDK 调度
- **`plan`**: `--prompt` 模式集成 `dispatchSubagent`，支持 `schedule-planner` 子 Agent SDK 调度
- **统一模式**：非 TTY + Qoder 环境下触发，失败时无缝回退到 Prompt 模式
- **统一输出**：SDK 成功时输出 `[SPECCORE_RESULT]` + 文件变更列表 + 执行结果摘要

### 说明

- `ask` 命令不直接集成：ask 输出的是 `[SPECCORE_EXEC: speccore xxx]` 命令路由，由目标命令（analyze/split/plan/execute）在执行时自行触发 SDK 调度
- Pipeline 推进点（`[SPECCORE_STEP_DONE]` + `[SPECCORE_NEXT_STEP]`）保持原有标记模式，避免 CLI 内部状态机与 SDK 异步执行冲突

---

## v8.3.169 (2026-09-16) — Qoder Agent SDK 集成：真正的多 Agent 调度

### 新增：Qoder Agent SDK 集成 (`src/core/agent-adapter.ts`)

- **安装**: `@qoder-ai/qoder-agent-sdk` 作为 `optionalDependencies`
- **QoderSdkAdapter 真正实现**（替代之前的空壳预留接口）：
  - 使用动态 `import()` 加载 SDK，未安装时自动回退 Headless
  - `dispatchSubagent()` 通过 `query({ prompt, options })` 直接调用 Qoder Agent
  - 构建 `AgentDefinition` 自定义子 Agent（`spec-analyzer`、`spec-executor` 等映射到 Qoder 子 Agent）
  - 消费 SDK 消息流，收集文本回复和文件变更列表
  - 内置 Agent 名称映射（`general-purpose` / `Explore` / `Plan`）
- **新增 `dispatchSubagent` 统一调度入口**：
  - Qoder 环境 → 调用 `QoderSdkAdapter.dispatchSubagent()`
  - 其他环境 → 返回 `null`（由外层 AI 通过 `[SPECCORE_SUBAGENT]` 标记接管）
- **Headless 始终兜底**：任何 SDK 调用失败自动回退到文本标记模式

### 新增：多工具适配支持 (`src/core/ask-host-ai.ts`)

- **扩展 `HostAiTool`**: 新增 `cursor` / `windsurf` / `claude` / `codebuddy`
- **修复 `detectHostAi`**: `.qoder` 目录现在正确返回 `'qoder'`（之前错误返回 `'trae'`）
- **精确目录映射**: `DIR_TO_TOOL` 按目录名精确映射到对应工具
- **新增 `QODER_SESSION` 环境变量检测**

### Analyze 命令集成 (`src/commands/analyze.ts`)

- **Pipeline 模式 SDK 调度**: 在输出 Prompt 之前，尝试通过 `dispatchSubagent` 直接调度子 Agent
- **仅在非 TTY + Qoder 环境下触发**，失败时无缝回退到 Prompt 模式
- **输出结果摘要**: SDK 执行成功后输出 `[SPECCORE_STEP_DONE]` + `[SPECCORE_RESULT]` + 文件变更列表

### 架构设计

- **AgentAdapterMode 扩展**: `'headless' | 'qoder-sdk' | 'cursor-sdk' | 'windsurf-sdk' | 'claude-sdk' | 'codebuddy-sdk'`
- **AgentAdapter 接口扩展**: 新增可选 `dispatchSubagent()` 方法
- **`createAgentAdapter()` 自动检测**: 根据 `detectHostAi()` 结果自动选择适配器（Qoder → QoderSdkAdapter，其他 → HeadlessAdapter）

---

