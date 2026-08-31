# .speccore/PROJECT.yaml 升级差异报告

生成时间: 2026/8/31 12:10:19
当前 schema_version: 1

## 检测到的变更

🏗️  结构变更（3 项，需人工确认）:
   ~ platforms: 类型从 object 变为 array
   ~ git.protected_branches: 类型从 object 变为 array
   ~ code_scope: 类型从 object 变为 array

## 处理建议

运行: speccore config --upgrade --project