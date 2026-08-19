---
name: spec-help
description: >
  帮助中心专属 Skill。在调用 speccore ask 之前，检测 CLI 版本是否为最新，
  发现新版本时提示用户更新。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-help — 帮助中心（专属逻辑）

> **定位**：`/help` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/help
/help --web
```

---

## 执行流程

```
用户输入 /help
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 前置校验                        │
│ 比较本地 CLI 版本与项目记录版本            │
└───────────────────────────────────────┘
        │
   ┌────┴────┐
   ▼         ▼
 有新版本    最新版
   │         │
   ▼         ▼
输出提示    调用 ask
建议更新    执行 help
```

---

## 前置校验

### 版本检测

```bash
# 获取本地安装的 CLI 版本
localVer=$(speccore --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")

# 获取项目记录的版本（如果有）
projectVer=$(cat .speccore/local/version.json 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "none")

echo "local: $localVer, project: $projectVer"
```

### 发现新版本时的提示

```
📦 版本更新提示

本地 CLI:  v6.77.1
项目记录:  v6.77.0

发现新版本，建议更新：
  npm install -g speccore@latest

更新后运行 speccore init --update 同步项目配置。
```

---

## 执行

直接调用 `speccore ask`：

```
直接执行: execute_command("speccore ask '显示命令帮助中心'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
```
