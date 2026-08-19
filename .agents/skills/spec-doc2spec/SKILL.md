---
name: spec-doc2spec
description: >
  文档转规格专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（文件存在性、格式检测），参数缺失时输出交互式提示。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-doc2spec — 文档转规格（专属逻辑）

> **定位**：`/doc2spec` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/doc2spec [参数]
/doc2spec --file PRD.pdf -I Iteration-001
/doc2spec --file requirements.docx --output 010-requirements/converted/
```

---

## 执行流程

```
用户输入 /doc2spec [参数]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 参数提取                        │
│ 从用户输入提取 file/iteration/output 等 │
└───────────────┬───────────────────────┘
                │
        参数缺失？
                │
        是 ──► 输出交互式提示
                │
        否 ──► 继续
                │
                ▼
┌───────────────────────────────────────┐
│ Step 2: 前置校验                        │
│ - 文件是否存在？                        │
│ - 格式是否支持？                        │
│ - 迭代是否存在？                        │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 3: 调用 speccore ask               │
└───────────────────────────────────────┘
```

---

## Step 1: 参数提取

| 参数 | 短名 | 长名 | 必填 | 说明 |
|:---|:---|:---|:---|:---|
| file | -f | --file | 是 | 源文档路径（PDF/DOCX/MD/HTML）|
| iteration | -i | --iteration | 否 | 目标迭代名 |
| output | -o | --output | 否 | 输出目录 |
| prompt | - | --prompt | 否 | 只输出 Prompt，不执行 |

---

## Step 2: 参数缺失 → 交互式提示

```
📄 speccore doc2spec — 文档转规格

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -f, --file <path>         源文档路径（必填）
                            支持: .pdf, .docx, .md, .html, .txt
  -I, --iteration <name>    目标迭代（默认: 当前迭代）
  -o, --output <dir>        输出目录（默认: 010-requirements/converted/）
      --prompt              只输出 Prompt，不执行转换

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /doc2spec -f PRD.pdf                      # 转换 PDF 到当前迭代
  /doc2spec -f requirements.docx -I Q1      # 转换到指定迭代
  /doc2spec -f design.md -o ./output/       # 指定输出目录
  /doc2spec -f PRD.pdf --prompt             # 只生成 Prompt

请补充 --file 参数后重新调用。
```

---

## Step 3: 前置校验

### 3.1 检查文件是否存在
```bash
# 检查 --file 指定的路径
# 如果不存在 → 提示用户确认路径
```

### 3.2 检查文件格式
```bash
# 支持的格式: .pdf, .docx, .md, .html, .txt
# 如果格式不支持 → 提示用户
```

### 3.3 检查迭代是否存在
```bash
# 如果指定了 -I，检查迭代目录是否存在
# 如果不存在 → 提示用户先创建迭代
```

---

## Step 4: 调用 speccore ask

```bash
execute_command("speccore ask '将文档转为规格...'")
```

> ⚠️ 最终仍然调用 `speccore ask`，不要绕过 ask 引擎。
