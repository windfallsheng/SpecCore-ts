# SpecCore Router — 意图→命令 路由器

## 规则
1. 从用户对话识别意图
2. 提取参数
3. **只输出 CLI 命令文本，不执行**
4. 参数缺失时追问

## 意图映射
| 关键词 | CLI 命令 |
| :--- | :--- |
| 初始化/init/开始 | speccore init |
| 创建迭代/新建期次 {name} | speccore iteration create -n {name} --owner {owner} |
| 导入需求 {file} 到 {iter} | speccore doc2spec -f {file} --iter {iter} |
| 分析/检查 {iter} | speccore analyze -I {iter} |
| 拆分/split {iter} | speccore iteration split -I {iter} |
| 执行/开发 {task} | speccore execute -t {task} --force |
| 执行全部 | speccore execute --all --force |
| 断点续跑 | speccore execute --resume |
| PR/推代码 {task} | speccore pr --task {task} |
| 完成/归档 {task} | speccore done --task {task} |
| 变更需求 "{desc}" {task} | speccore change "{desc}" --task {task} |
| 校验/验证 {iter} | speccore validate -I {iter} |
| 进度/仪表盘 | speccore dashboard --scope global |
| 项目名片 | speccore welcome |
| 帮助 | speccore help |
| 回顾/复盘 {task} | speccore retro --task {task} |
| 全部回顾 | speccore retro --all |
| 智能级联/推进 | speccore dev |
| 搜索 {keyword} | speccore search {keyword} |