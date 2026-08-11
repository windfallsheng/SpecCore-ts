---
name: spec-ask
description: SpecCore AI Router
---
1. Read .speccore/CONSTITUTION.md for project context
2. Read .speccore/local/context.json for current iteration
3. Execute: speccore ask "${1:描述你的需求}"
4. **Check stdout for markers — ONBOARD is mandatory:**
   - If output contains `[SPECCORE_ONBOARD: <path>]` → 🚨 **MUST handle first, cannot skip:**
     a. If your platform supports `present_files` or file preview → immediately show that HTML onboarding page
     b. If your platform cannot directly show HTML → output to user: "🎉 首次使用 SpecCore！请先打开引导页查看使用说明：`<path>`" and wait for user acknowledgment before proceeding
     c. Only AFTER the onboarding page is shown/acknowledged, continue processing other output
   - If output contains `[SPECCORE_EXEC: <cmd>]` → execute that command
   - If output contains `[SPECCORE_INTENT]` → show the intent to user for confirmation
