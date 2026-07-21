#!/usr/bin/env bash
# ===========================================================================
# word2md — Word → Markdown 通用转换器
# 用法: ./convert.sh <源文件.docx> [输出.md] [图片目录]
# ===========================================================================
set -euo pipefail

INPUT="$1"
OUTPUT="${2:-${INPUT%.*}.md}"
IMAGE_DIR="${3:-./images}"

[ $# -lt 1 ] && echo "用法: $0 <源文件.docx> [输出.md] [图片目录]" && exit 1
[ ! -f "$INPUT" ] && echo "❌ 文件不存在: $INPUT" && exit 1

export LANG=zh_CN.UTF-8

mkdir -p "$IMAGE_DIR"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  word2md: Word → Markdown"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  输入: $INPUT"
echo "  输出: $OUTPUT"
echo "  图片: $IMAGE_DIR/"
echo ""

# .doc 旧格式处理
EXT="${INPUT##*.}"
TEMP=""
if [ "$EXT" = "doc" ]; then
  echo "  📄 .doc → .docx..."
  soffice --headless --convert-to docx "$INPUT" --outdir /tmp/ 2>/dev/null
  TEMP="/tmp/$(basename "$INPUT" .doc).docx"
  [ ! -f "$TEMP" ] && echo "❌ 需要 LibreOffice" && exit 1
  INPUT="$TEMP"
fi

# 转换
echo "  🔄 pandoc..."
pandoc "$INPUT" -f docx -t gfm --wrap=none --extract-media="$IMAGE_DIR" -o "$OUTPUT"

# 清理
[ -n "$TEMP" ] && rm -f "$TEMP"

# 后处理
perl -i -0pe 's/\n{3,}/\n\n/g' "$OUTPUT"
sed -i '' 's/"/"/g; s/"/"/g' "$OUTPUT" 2>/dev/null || true

# 图片路径修正
sed -i '' "s|](${IMAGE_DIR}/media/|](${IMAGE_DIR}/|g" "$OUTPUT" 2>/dev/null || true

IMAGE_COUNT=$(find "$IMAGE_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo "  ✅ 完成 — $OUTPUT ($(wc -c < "$OUTPUT" | tr -d ' ')B) — ${IMAGE_COUNT} 张图"
