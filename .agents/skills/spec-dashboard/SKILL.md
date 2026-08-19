---
name: spec-dashboard
description: >
  仪表盘专属 Skill。在调用 speccore ask 之前，检测当前是否有活跃迭代，
  无迭代时提示用户先创建迭代。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-dashboard — 仪表盘（专属逻辑）

> **定位**：`/dashboard` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/dashboard
/dashboard --scope global
```

---

## 执行流程

```
用户输入 /dashboard
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 前置校验                        │
│ 检查 context.json 中是否有 currentIteration│
└───────────────────────────────────────┘
        │
   ┌────┴────┐
   ▼         ▼
 无迭代      有迭代
   │         │
   ▼         ▼
输出提示    调用 ask
引导创建    执行 dashboard
```

---

## 前置校验

### 检查活跃迭代

```bash
# 读取 context.json 中的 currentIteration
current=$(cat .speccore/local/context.json 2>/dev/null | grep -o '"currentIteration"[^,]*' | grep -o '"[^"]*"' | tail -1 | tr -d '"')

if [ -n "$current" ] && [ "$current" != "null" ]; then
  echo "has-iteration: $current"
else
  echo "no-iteration"
fi
```

### 无迭代时的交互提示

```
📊 仪表盘

当前没有活跃的迭代。

建议操作：
  speccore iteration create -n <迭代名称>   # 创建新迭代
  speccore context --set --iteration <名称>   # 切换到已有迭代

创建迭代后，可重新执行 /dashboard 查看项目进度。
```

---

## 执行

有活跃迭代时，直接调用 `speccore ask`：

```
直接执行: execute_command("speccore ask '显示项目仪表盘'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
```
