---
name: spec-once
description: >
  SpecCore 单会话端到端执行 Skill。任意形式的需求入口（已切分的功能单元 / 一个文档地址 /
  一句话需求）→ 澄清 → 分析 → 拆分任务 → 执行开发 → 本地冒烟，整条链在单次会话内跑完，
  全程与用户交互确认。触发词：spec once、/once、一次跑完、快速跑、快速分析、小步快跑、
  端到端 等。与流水线（speccore run/dev）的区别：spec-once 由宿主 AI 单会话编排现有命令，
  覆盖「开发到冒烟」的快速闭环（不含 PR 提交/归档收尾，那些按需走 pr/done），
  适合少量功能单元（建议 ≤3 个）的快速推进；大范围多单元请走流水线。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

# spec-once — 单会话端到端执行

## 定位
把「澄清→分析→拆分→执行→冒烟」五步装进一次会话，一步到位，但**每一步都停下来跟用户确认**。
底层全部复用 speccore 现有命令，本 skill 只做编排与交互节点（像 article-to-html 一样
把复杂流程装进一份剧本，但每个关键节点用户可喊停）。

## 流程（逐步执行，禁止跳步，禁止自动续跑）

### Step 0 入口识别与范围确认

先识别用户给了什么，按入口执行预处理，再统一做范围确认：

**入口 A：已切分好的功能单元**（用户指定了单元名或说「全部」）
- 直接进入下方「范围确认」，无需预处理

**入口 B：一个文档地址**（.md / .docx / .pdf，多个文档可批量）
- `.md` → 执行 `speccore unitize -f "<路径>"`（多文档可 `--files "a.md=端1,b.md"`，端名须与 CONSTITUTION.md 一致）
- `.docx/.pdf` → 先执行 `speccore doc2spec -f "<路径>"` 转换为 MD，再对 converted/ 下转换出的 MD 执行 unitize 切分
- 切分完成后汇报单元清单，进入下方「范围确认」

**入口 C：一句话需求**
- 执行 `speccore req-doc "<用户原话>" --prompt --to <迭代>`，按 `[SPECCORE_PROMPT]` 把口语化需求整理为 PRD 级需求文档
- 落盘后再走入口 B（unitize 切分该文档），进入下方「范围确认」

**范围确认（三入口统一汇合点）**
1. 执行 `speccore status` 查看当前迭代、功能单元清单（010-requirements/features/）、020-specs 已有产物
2. 向用户确认本次范围：指定哪几个功能单元，还是全部
3. 边界提醒：单会话建议 ≤3 个单元；全部单元时警告「上下文可能超载，建议分批或改用流水线」，用户坚持再继续
4. 对每个单元检查 020-specs/{单元}/ 是否已有分析产物——有则问用户「跳过 / 重新分析」
5. 目录/任务命名由 CLI 确定性生成（单元目录 {文档slug}-{序号}-{标题}、Task-{编号}-{slug}、子任务 Task-{父任务}-{端名}），不要自己改

### Step 1 澄清与分析
1. 执行 `speccore analyze --prompt -I <迭代> [--feature <单元>]`
2. stdout 出现 `[SPECCORE_PROMPT]` → 将 Prompt 内容作为你的工作指令执行（不要改写、不要略过）
3. 分析中发现需求模糊点 → **向用户提问澄清**，不要自行脑补
4. 分析完成后按 Prompt 中的写入格式执行 `speccore analyze --apply '{json}' -I <迭代>` 落盘
5. 向用户汇报分析产出摘要（单元、文档、关键结论），**停下等确认**

### Step 2 拆分任务
1. 用户确认后执行 `speccore iteration taskify -I <迭代>`
2. 展示拆分出的任务清单（030-tasks/Task-*）与依赖关系
3. **停下问用户**：任务拆分是否合理？需要调整吗？

### Step 3 执行开发
1. 用户确认后，逐任务执行 `speccore execute --prompt -t <Task>`
2. 拿到 `[SPECCORE_PROMPT]` 后按 Prompt 写代码（写到 CONSTITUTION.md 声明的源码路径，禁止写入迭代目录）
3. 每个任务完成后简短汇报，继续下一个任务
4. 全部完成后输出总结（完成的任务、产出文件、遗留问题）

### Step 4 本地冒烟
1. 执行 `speccore verify --stage dev`（编译 + Lint + 单元测试，代码层冒烟，不依赖浏览器）
2. 若本次范围含**前端任务**（h5/web 等），再执行 `speccore verify --ui --smoke-only`（UI 层冒烟）
   - 冒烟需要本地服务：先问用户「本地服务是否已启动？」，未启动则提示启动命令（或用户提供 --url）后再跑
3. 冒烟通过 → 汇报通过项清单，**停下等确认**
4. 冒烟失败 → 读取失败报告定位根因 → 修复代码 → 重新执行本步（最多 2 轮修复循环）
   - 2 轮后仍失败：把失败项写入 .issues.md 并向用户报告，不静默跳过、不谎报通过

### 可选收尾（不自动执行）
- 全部冒烟通过后，提示用户可选操作：`speccore pr`（提交代码 + 创建 PR）、`speccore done`（归档收尾），由用户决定是否继续

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步需开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 提示用户开新对话并先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理

## 铁律
- **每个节点必须停下等用户确认**（范围 → 澄清 → 分析 → 拆分 → 执行 → 冒烟），禁止自动续跑
- 代码写到 CONSTITUTION.md 声明的源码路径，禁止写入迭代目录
- 禁止自己创建目录、写 Spec 文件绕过 CLI——所有 Spec 操作通过 speccore 命令
- 失败时读取 .issues.md 并向用户报告，不要静默跳过；冒烟不通过不得宣布流程完成
- 单会话上下文不够时（prompt 超预算报错），停下建议用户改用流水线分步执行
