# SpecCore Change — 需求变更 + Prompt/Apply

> **角色**: 记录变更 → 分析影响 → 通过 Prompt/Apply 重新生成受影响的代码

## 执行流程

```
1. 用户: "把登录改成验证码登录"
2. Skill 记录变更，分析影响范围 → Task-001 受影响
3. execute_command("speccore execute --prompt -t Task-001")
4. 捕获 [SPECCORE_PROMPT]，提交给 AI（附变更描述）
5. AI 返回修正后的代码
6. execute_command("speccore execute --response '...' -t Task-001")
```
