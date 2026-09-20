/**
 * Excel 提取（含内嵌图片）— v8.3.207+
 *
 * 用 exceljs（可选依赖）读取 xlsx，同时提取：
 * 1. 单元格文本（每行一个 bug 的描述）
 * 2. 内嵌图片（按 range.tl.nativeRow 关联到对应的 bug 行）
 *
 * 供「bug Excel 表导入」场景使用：描述 + 截图一起进任务上下文，宿主 AI 能 Read 图片看到缺陷。
 * exceljs 未安装时返回 null，调用方回退到纯文本解析（xlsx 库）。
 */

export interface ExcelImage {
  /** 图片关联的行号（0-based，含表头行） */
  rowIndex: number;
  /** 图片扩展名（png/jpeg/gif） */
  ext: string;
  /** 图片二进制数据 */
  buffer: Buffer;
}

export interface ExcelBugRow {
  /** 行号（0-based） */
  rowIndex: number;
  /** 该行所有单元格文本（已过滤空串） */
  cells: string[];
  /** 该行关联的图片 */
  images: ExcelImage[];
  /** 优先级列（若表头识别到） */
  priority?: string;
  /** 严重度列（若表头识别到） */
  severity?: string;
  /** 模块列（若表头识别到，可喂给 .meta/feature 关联功能模块） */
  module?: string;
}

/** 表头列名 → 字段 的模糊匹配规则（先精确后宽松） */
const COLUMN_HINTS: Record<string, RegExp> = {
  priority: /优先级|优先|priority|紧急程度|等级|level|p\d/i,
  severity: /严重度|严重程度|severity|s\d/i,
  module: /所属模块|功能模块|模块|子系统|feature|module/i,
  title: /标题|名称|问题|摘要|主题|缺陷名|title|name|bug/i,
  desc: /描述|说明|详情|现象|复现|description|detail|desc/i,
};

/** 提取单元格文本（字符串/数字/富文本/公式） */
function cellText(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r: any) => r.text).join('');
    if (v.result !== undefined) return String(v.result);
    if (v.text !== undefined) return String(v.text);
    return String(v);
  }
  return String(v);
}

/**
 * 提取 Excel 的 bug 行（文本 + 内嵌图片 + 优先级/严重度/模块列）
 * @param filePath xlsx 文件路径
 * @returns bug 行数组；exceljs 不可用或解析失败时返回 null
 */
export async function extractExcelBugs(filePath: string): Promise<ExcelBugRow[] | null> {
  let ExcelJS: any;
  try {
    ExcelJS = require('exceljs');
  } catch {
    return null; // exceljs 未安装，调用方回退纯文本
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return null;

    // 0. 读表头（第一行），识别优先级/严重度/模块等列
    const colHints: Record<string, number> = {};
    worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
      const text = cellText(cell.value).trim().toLowerCase();
      if (!text) return;
      for (const [field, re] of Object.entries(COLUMN_HINTS)) {
        if (colHints[field] === undefined && re.test(text)) {
          colHints[field] = colNumber;
        }
      }
    });

    // 1. 提取所有图片，按行号分组
    const imagesByRow = new Map<number, ExcelImage[]>();
    for (const img of worksheet.getImages()) {
      const row = img.range?.tl?.nativeRow;
      if (row === undefined || row === null) continue;
      const media = workbook.getImage(img.imageId);
      const buf = media?.buffer || (media?.base64 ? Buffer.from(media.base64, 'base64') : null);
      if (!buf || buf.length === 0) continue;
      const ext = (media?.extension || 'png').replace(/^\./, '');
      const list = imagesByRow.get(row) || [];
      list.push({ rowIndex: row, ext, buffer: buf });
      imagesByRow.set(row, list);
    }

    // 2. 提取每行文本 + 结构化字段（跳过首行表头）
    const rows: ExcelBugRow[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
      if (rowNumber <= 1) return; // 跳过表头
      const cells: string[] = [];
      const cellByCol: Record<number, string> = {};
      row.eachCell({ includeEmpty: false }, (cell: any, colNumber: number) => {
        const t = cellText(cell.value).trim();
        if (t) {
          cells.push(t);
          cellByCol[colNumber] = t;
        }
      });
      if (cells.length === 0) return;
      const idx = rowNumber - 1; // 转 0-based
      const get = (field: string): string | undefined =>
        colHints[field] !== undefined ? cellByCol[colHints[field]] : undefined;
      rows.push({
        rowIndex: idx,
        cells,
        images: imagesByRow.get(idx) || [],
        priority: get('priority'),
        severity: get('severity'),
        module: get('module'),
      });
    });

    return rows;
  } catch {
    return null;
  }
}

/**
 * 纯文本回退：用 xlsx（SheetJS）读 Excel，只拿单元格文本（无图片）
 * 供 exceljs 不可用时的降级路径
 */
export async function extractExcelTextOnly(filePath: string): Promise<string[] | null> {
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    return data
      .slice(1)
      .filter((row: any[]) => row.some((c: any) => c))
      .map((row: any[]) => row.filter((c: any) => c).join(' — '));
  } catch {
    return null;
  }
}
