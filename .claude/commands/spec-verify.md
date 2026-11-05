---
name: spec-verify
description: 测试验证专属 Skill。覆盖 verify 命令的测试意图识别与参数提取。支持自然语言（"跑一下冒烟测试"）和显式参数（--config ./tests/smoke.yaml）。参数缺失时交互式提示，自动发现测试配置文件。AI 浏览器验证模式（v8.3.350+）：--ai 生成自然语言验证剧本（宿主 AI 视觉执行，无需 selector），--ai-report 生成 HTML 报告，--ai-judge 视觉判定兜底。不影响 speccore ask 的意图识别能力。
---
speccore verify --ui --stage ${1|dev,pr,deploy,release|} | speccore verify --ai --scope ${2|all,deployed,modules:单元名|}
