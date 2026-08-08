# 代码生成输出格式

## Prompt/Apply 协议
1. CLI: `speccore execute --prompt -t Task-001` → exitCode=10
2. AI 读取 ANALYSIS.md, REQUIREMENT.md
3. AI 生成代码 JSON: `{"files": [{"path": "...","content": "..."}]}`
4. 写入 /tmp/speccore-resp.json
5. CLI: `cat /tmp/speccore-resp.json | speccore execute --response - -t Task-001`

## 强制约束
- 每个文件必须有 import 语句
- API 必须完整（controller + service + model + DDL）
- 逾 60s → 分批返回，先核心 API
