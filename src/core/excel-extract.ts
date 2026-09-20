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
}

/**
 * 提取 Excel 的 bug 行（文本 + 内嵌图片）
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

    // 2. 提取每行文本（跳过首行表头）
    const rows: ExcelBugRow[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
      if (rowNumber <= 1) return; // 跳过表头
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell: any) => {
        const v = cell.value;
        if (v === null || v === undefined) return;
        let text = '';
        if (typeof v === 'string') text = v;
        else if (typeof v === 'number') text = String(v);
        else if (typeof v === 'object') {
          // 富文本 / 公式 / 超链接等
          if (v.richText) text = v.richText.map((r: any) => r.text).join('');
          else if (v.result !== undefined) text = String(v.result);
          else if (v.text !== undefined) text = String(v.text);
          else text = String(v);
        } else {
          text = String(v);
        }
        const t = text.trim();
        if (t) cells.push(t);
      });
      if (cells.length === 0) return;
      const idx = rowNumber - 1; // 转 0-based
      rows.push({ rowIndex: idx, cells, images: imagesByRow.get(idx) || [] });
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
