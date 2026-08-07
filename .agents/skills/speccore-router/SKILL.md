# SpecCore Router — 统一入口

## 核心规则（必须遵守）

1. **先确认，再执行** — 识别意图后，先展示将要做什么，等用户确认后才执行
2. **单一操作** — 每次只执行一条命令，不要自动走全流程
3. 参数缺失时主动追问
4. 复杂意图输出完整步骤+命令序列，让用户逐条确认

## 执行流程

```
用户输入
  ↓
识别意图 + 提取参数
  ↓
展示确认信息: "我将执行: speccore {cmd}，是否继续？"
  ↓
用户确认 → 执行
用户拒绝 → 停止
用户调整 → 修改后重新展示
```

## 意图映射

| 关键词 | CLI 命令 |
| :--- | :--- |
| 初始化/init/开始 | `speccore init` |
| 创建迭代/新建期次 {name} | `speccore iteration create -n {name} --owner {owner}` |
| 导入需求 {file} | `speccore doc2spec -f {file} --iter {iter}` |
| 分析/检查 {iter} | `speccore analyze -I {iter}` |
| 拆分/split {iter} | `speccore iteration split -I {iter}` |
| 计划/plan {iter} | `speccore plan -I {iter}` |
| 执行/开发 {task} | `speccore execute -t {task} --force` |
| 执行全部 | `speccore execute --all --force` |
| 分批执行 {n} | `speccore execute --all --batch-size {n} --force` |
| 断点续跑 | `speccore execute --resume` |
| PR/推代码 {task} | `speccore pr --task {task}` |
| 完成/归档 {task} | `speccore done --task {task}` |
| 变更需求 "{desc}" | `speccore change "{desc}" --task {task}` |
| 校验/验证 {iter} | `speccore validate -I {iter}` |
| 进度/仪表盘 | `speccore dashboard --scope global` |
| 项目名片 | `speccore welcome` |
| 帮助 | `speccore help` |
| 回顾/复盘 {task} | `speccore retro --task {task}` |
| 全部回顾 | `speccore retro --all` |
| 智能级联/推进 | `speccore dev` |
| 搜索 {keyword} | `speccore search {keyword}` |

## 复杂编排（关键词：分批/定时/多任务/计划...）

当意图无法简单映射时，使用以下流程：

1. 调用 `speccore ask "用户原话"` 获取编排方案
2. 输出完整的执行步骤和命令序列：
   ```
   步骤 1: speccore plan -I {iter}
   步骤 2: speccore execute --all --batch-size {n} --force
   步骤 3: speccore retro --all
   ```
3. 对于定时任务：`speccore schedule create --at "HH:MM" --all`

## 输出格式

### 简单命令（能直接执行）
```
speccore execute -t Task-001 --force
```
然后尝试用终端执行。如果终端不可用，提示用户复制执行。

### 复杂编排（输出步骤+命令）
```
📋 执行计划：
① speccore plan -I Q1                    ← 生成执行计划
② speccore execute --all --batch-size 3 --force  ← 分批执行
③ speccore retro --all                   ← 完成回顾

请在终端逐条执行，或在 WorkBuddy 中一键运行。
```

## 确认格式

### 简单命令
```
将执行:
  speccore execute -t Task-001 --force

说明: 执行 Task-001 的代码生成，强制模式。

是否继续？[确认 / 调整 / 取消]
```

### 复杂编排
```
📋 拟执行计划:

① speccore plan -I Q1             ← 生成执行计划
② speccore execute --all --batch-size 3 --force  ← 分3批执行
③ speccore retro --all            ← 完成回顾

是否按此计划执行？[确认 / 调整 / 取消]
```

## 示例

用户: "开发 Task-001"
→ 展示: "将执行 speccore execute -t Task-001 --force，是否继续？"
→ 确认后执行，不确认不走下一步

用户: "创建迭代 Q1 负责人张三"
→ 展示: "将创建 Iteration-001-Q1，负责人张三，是否继续？"
→ 确认后执行

用户: "支付功能分3批晚上8点执行"
→ 展示完整的 3 步执行计划 + 对应的 CLI 命令
→ 用户确认每一步或整个计划后执行
