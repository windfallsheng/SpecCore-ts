---
name: spec-run
description: 端到端流水线专属 Skill。在调用 speccore run 之前，执行参数提取（需求描述、迭代、起止阶段、演示模式），参数缺失时输出交互式提示。不影响 speccore run 的意图识别能力。
---
直接执行: execute_command("speccore run '用户的一句话需求'")

不要输出命令文本，不要分析意图，一切交给 speccore run。

流水线会自动从澄清一路跑到部署，中间三个 review 闸口（Spec 定稿 / 代码 review / 部署前确认）会停下来等你确认，看到 [SPECCORE_GATE_X] 标记时停下 review 并询问用户。

## run 位置参数文法（快捷语法糖，v8.3.290+）
用户说的如果是以下形态，直接拼成对应命令，不转 ask：
- `run <preset名>` → 直呼预设流水线（develop/deploy/deliver/docs/full/…）
- `run <from> to <to>` / `run <from>..<to>` → 阶段范围（别名: split→split-units、smoke→verify、deploy→pipeline、code→execute、tasks→taskify、ship→pr、archive→done、docs→spec2doc、import→doc2spec、req→req-doc）
- `run <一句话需求>` → 需求入口全流程
- 需求文本恰为保留字时用 --demand 逃生舱
其他快捷糖：`analyze -g`（全局层分析）、`unitize <文件>` / `doc2spec <文件>`（文件位置参数）、`verify dev|pr|deploy|release`（测试阶段直呼）

## 智能续跑（无参 run 快捷操作，v8.3.290+）
用户只发 `speccore run`（不带参数）时即为智能续跑：CLI 按里程碑产物检测断点。
- 输出 `🤖 智能续跑检测` 面板后若自动续跑（全新迭代且需求已就绪），无需干预，等闸口即可；
- 输出 `[SPECCORE_RESUME]` 时（已有步骤完成/断点续跑选择/无需求文档），停下用 AskUserQuestion 询问用户：
  - 面板给「①从断点继续 ②重新切分 ③自定义起止」→ 用户选定后执行面板中对应命令；
  - 面板给「①导入 PRD 文档 ②一句话需求」→ 用户选定后按选择提供文档路径或需求描述再执行；
  - 未等用户确认不得自行续跑。
