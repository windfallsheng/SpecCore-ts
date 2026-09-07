---
name: spec-deploy
description: 部署专属 Skill。覆盖 build / deploy / pipeline 命令的意图识别与参数提取。支持自然语言（"部署到测试环境"）和显式参数（--env test --all）。参数缺失时交互式提示，前置校验环境配置与平台有效性。不影响 speccore ask 的意图识别能力。
---
speccore pipeline --env ${1|local,dev,test,staging,production|} --all