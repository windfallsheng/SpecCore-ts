---
name: spec-iteration-create
description: 创建迭代专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（迭代名是否已存在、主题词有效性），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。主题词英译（v8.3.372+）：ask 命令中含 --topic "中文主题" 时执行前英译（「支付」→ payment），无法确定译名保留原样（CLI 拼音兜底）。
---

speccore iteration create -n ${1:Q2} --owner=${2|张三,李四,王五|}

## 主题词英译（v8.3.372+）
- ask 输出的执行命令中含 `--topic "中文主题"` 时，执行前把中文主题英译（如「支付」→ `payment`）；
- 无法确定译名时保留原样执行（CLI 自带拼音兜底，如「支付」→ `zhi-fu`）；
- 若 ask 未提取出主题而用户原话明显带主题（「主要做 X」），执行后主动补充 `--topic` 重跑。
