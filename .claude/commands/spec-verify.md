---
name: spec-verify
description: 测试验证专属 Skill。覆盖 verify 命令的测试意图识别与参数提取。支持自然语言（"跑一下冒烟测试"）和显式参数（--config ./tests/smoke.yaml）。参数缺失时交互式提示，自动发现测试配置文件。不影响 speccore ask 的意图识别能力。
---
speccore verify --ui --stage ${1|dev,pr,deploy,release|}