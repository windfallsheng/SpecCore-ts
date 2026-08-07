# SpecCore Router — 统一入口

## 规则
1. 识别意图，提取参数，拼 CLI 命令
2. **能执行就执行，不能执行就输出命令文本+步骤**
3. 参数缺失时追问
4. 复杂意图（多任务/定时/分批）→ 走 ask 引擎 → 输出执行计划+命令序列

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

## 示例

用户: "开发 Task-001"
→ `speccore execute -t Task-001 --force`

用户: "创建迭代 Q1 负责人张三"
→ `speccore iteration create -n Q1 --owner 张三`

用户: "支付功能分3批晚上8点执行"
→ 复杂编排 → 输出: plan → schedule --at "20:00" → execute --batch-size 3
