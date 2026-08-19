---
name: spec-welcome
description: >
  欢迎页专属 Skill。在调用 speccore ask 之前，检测项目是否已初始化
  （.speccore/ 目录是否存在），未初始化时引导用户先执行 speccore init。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-welcome — 欢迎页（专属逻辑）

> **定位**：`/welcome` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/welcome
```

---

## 执行流程

```
用户输入 /welcome
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 前置校验                        │
│ 检查 .speccore/ 目录是否存在              │
└───────────────────────────────────────┘
        │
   ┌────┴────┐
   ▼         ▼
 不存在     存在
   │         │
   ▼         ▼
输出提示    调用 ask
引导 init   执行 welcome
```

---

## 前置校验

### 检查项目初始化状态

```bash
ls -d .speccore 2>/dev/null && echo "initialized" || echo "not-initialized"
```

### 未初始化时的交互提示

```
⚠️  项目尚未初始化

当前目录未检测到 .speccore/ 规范数据库，无法展示项目名片。

建议操作：
  speccore init                    # 初始化 SpecCore 项目

初始化完成后，可重新执行 /welcome 查看项目状态。
```

---

## 执行

项目已初始化时，直接调用 `speccore ask`：

```
直接执行: execute_command("speccore ask '显示项目欢迎页'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
```
