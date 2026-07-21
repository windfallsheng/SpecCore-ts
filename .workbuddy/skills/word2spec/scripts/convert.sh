#!/usr/bin/env bash
# ===========================================================================
# word2spec — Word 需求文档 → SpecCore Markdown 高级转换器
# 用法: ./convert.sh <源文件.docx> <迭代名> <端名>
# 示例: ./convert.sh api-prd.docx Q3 后台
# ===========================================================================
set -euo pipefail

INPUT="$1"
ITERATION="$2"
PLATFORM="${3:-后台}"

# ── 参数检查 ──
if [ $# -lt 2 ]; then
  echo "用法: $0 <源文件.docx> <期次名> [端名]"
  echo "示例: $0 api-prd.docx Q3 后台"
  exit 1
fi

if [ ! -f "$INPUT" ]; then
  echo "❌ 文件不存在: $INPUT"
  exit 1
fi

# ── 加载环境 ──
export LANG=zh_CN.UTF-8

TARGET_DIR="期次-${ITERATION}/00-需求文档"
IMAGE_DIR="${TARGET_DIR}/images"
OUTPUT="${TARGET_DIR}/${PLATFORM}需求.md"

mkdir -p "$TARGET_DIR" "$IMAGE_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  word2spec: Word → SpecCore Markdown"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  源文件: $INPUT"
echo "  期次:   $ITERATION"
echo "  端:     $PLATFORM"
echo "  输出:   $OUTPUT"
echo "  图片:   $IMAGE_DIR/"
echo ""

# ── 检测格式 ──
EXT="${INPUT##*.}"
TEMP_DOCX=""

if [ "$EXT" = "doc" ]; then
  echo "  📄 检测到旧格式 .doc，先转 .docx..."
  soffice --headless --convert-to docx "$INPUT" --outdir /tmp/ 2>/dev/null
  BASENAME=$(basename "$INPUT" .doc)
  TEMP_DOCX="/tmp/${BASENAME}.docx"
  if [ ! -f "$TEMP_DOCX" ]; then
    echo "  ❌ .doc 转换失败，请安装 LibreOffice: brew install libreoffice"
    exit 1
  fi
  INPUT="$TEMP_DOCX"
  echo "  ✅ 已转为 .docx"
fi

# ── pandoc 转换 ──
echo "  🔄 正在转换..."
pandoc "$INPUT" \
  -f docx \
  -t gfm \
  --wrap=none \
  --extract-media="$IMAGE_DIR" \
  -o "$OUTPUT"

# ── 清理临时文件 ──
[ -n "$TEMP_DOCX" ] && rm -f "$TEMP_DOCX"

# ── 后处理 ──

# 1. 标题层级规范化（Word H1→H2, H2→H3）
sed -i '' 's/^## /### /g' "$OUTPUT"
sed -i '' 's/^# /## /g' "$OUTPUT"

# 2. 空行清理
perl -i -0pe 's/\n{3,}/\n\n/g' "$OUTPUT"

# 3. 图片路径修正（pandoc 生成的路径偶有多余层级）
sed -i '' "s|](${IMAGE_DIR}/media/|](images/|g" "$OUTPUT"
sed -i '' "s|](media/|](images/|g" "$OUTPUT"

# ── 智能检测 ──

# 检查是否有接口表格
HAS_IF_TABLE=$(grep -c "| 方法 | 路径 |" "$OUTPUT" 2>/dev/null || echo 0)

IMAGE_COUNT=0
[ -d "$IMAGE_DIR" ] && IMAGE_COUNT=$(find "$IMAGE_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')

# ── 追加接口提示（如果需要） ──
if [ "$HAS_IF_TABLE" -eq 0 ]; then
  cat >> "$OUTPUT" << 'TABLE_HINT'

---
> ⚠️ 本文件从 Word 自动转换。请在下方补充接口定义表格：

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| | | |
TABLE_HINT
fi

# ── 更新 INDEX.md ──
INDEX_FILE="${TARGET_DIR}/INDEX.md"
if [ ! -f "$INDEX_FILE" ]; then
  cat > "$INDEX_FILE" << INDEX_HEAD
# 本期需求文档索引

> 由 word2spec 自动生成

| 端 | 文件 | 转换时间 | 来源 |
| :--- | :--- | :--- | :--- |
INDEX_HEAD
fi

# 去重检查
if ! grep -q "| ${PLATFORM} |" "$INDEX_FILE" 2>/dev/null; then
  echo "| ${PLATFORM} | ${PLATFORM}需求.md | $(date +%Y-%m-%d) | ${INPUT##*/} |" >> "$INDEX_FILE"
fi

# ── 输出结果 ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ 转换完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  输出:   $OUTPUT ($(wc -c < "$OUTPUT" | tr -d ' ')B)"
echo "  图片:   ${IMAGE_COUNT} 张"
echo "  接口表: $([ "$HAS_IF_TABLE" -gt 0 ] && echo '✅ 已检测' || echo '⚠️ 缺失（已追加提示）')"
echo ""
echo "  📋 下一步:"
echo "    1. 检查自动转换的标题层级"
echo "    2. 补充接口定义表格"
echo "    3. speccore iteration split"
echo "    4. speccore execute --task=Task-001 --force"
