---
name: word2md
description: 纯 Word(DOCX) → Markdown 转换。与任何框架无关，仅负责高质量文档格式转换。支持 .docx/.doc、图片提取、中文编码、批处理。
agent_created: true
platform: macOS
---

# Word → Markdown 通用转换器

## 前置条件

- macOS + pandoc >= 3.x (`pandoc --version`)
- `.doc` 旧格式需要额外安装 LibreOffice (`which soffice`)

## 使用方式

用户说 "把这个 Word 转成 md" 即可。指定输入路径，缺省输出同目录同名 `.md`。

## 工作流

### 第 1 步 ── 确认输入

询问用户：
- 要转换哪些文件？（支持 `*.docx` / `*.doc` / 目录批量）
- 输出路径？（默认同目录同名 `.md`）
- 是否需要提取图片？（默认是，到 `./images/`）

### 第 2 步 ── 转换

#### .docx 格式（直接转）

```bash
LANG=zh_CN.UTF-8 pandoc "INPUT.docx" \
  -f docx \
  -t gfm \
  --wrap=none \
  --extract-media="${IMAGE_DIR:-./images}" \
  -o "OUTPUT.md"
```

| 参数 | 可选值 | 说明 |
| :--- | :--- | :--- |
| `-t` | `gfm` (默认) / `markdown` / `commonmark` | GFM 兼容性最强 |
| `--wrap` | `none` (默认) / `auto` | none 适合 AI 读取 |
| `--extract-media` | 任意目录 | 提取嵌入图片 |

#### .doc 旧格式（两步转换）

```bash
# 1. doc → docx
soffice --headless --convert-to docx "INPUT.doc" --outdir /tmp/

# 2. docx → md
LANG=zh_CN.UTF-8 pandoc "/tmp/INPUT.docx" \
  -f docx -t gfm --wrap=none \
  --extract-media="./images" -o "OUTPUT.md"

# 3. 清理临时文件
rm /tmp/INPUT.docx
```

### 第 3 步 ── 后处理（自动）

```bash
# 连续 3 个以上空行 → 2 个空行
perl -i -0pe 's/\n{3,}/\n\n/g' OUTPUT.md

# 中文引号统一
sed -i '' 's/"/"/g; s/"/"/g' OUTPUT.md
```

### 第 4 步 ── 输出报告

```
✅ 转换完成: REPORT.docx → REPORT.md
   大小: 45KB → 38KB
   图片: 3 张 → ./images/
   表格: 5 个（⚠️ 2 个含合并单元格，建议复核）
   时间: 0.8s
```

## 批量转换

```bash
for f in *.docx; do
  echo "→ $f"
  LANG=zh_CN.UTF-8 pandoc "$f" -f docx -t gfm --wrap=none \
    --extract-media="./images" -o "${f%.docx}.md"
done
echo "✅ 完成 $(ls *.docx | wc -l | tr -d ' ') 个文件"
```

## 常见问题

| 现象 | 原因 | 解决 |
| :--- | :--- | :--- |
| 中文乱码 | 未设 `LANG` | `export LANG=zh_CN.UTF-8` |
| 表格错位 | Word 合并单元格 | 手动复核，MD 不支持合并 |
| 图片丢失 | 未加 `--extract-media` | 加该参数并确认路径 |
| `.doc` 转换失败 | 缺少 LibreOffice | `brew install libreoffice` |
| 公式丢失 | Word 公式非 MathML | 截图替换 |

## 与 word2spec 的区别

| | word2md | word2spec |
| :--- | :--- | :--- |
| 定位 | 通用格式转换 | SpecCore 项目专用 |
| 输出位置 | 同目录 | 期次/00-需求文档/ |
| 后处理 | 引号、空行 | 标题层级、接口表格提示 |
| 依赖 SpecCore | ❌ | ✅ |
| 使用场景 | 任意 Word → MD | PRD → SpecCore 需求文档 |
