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
  /** 标题列（若表头识别到，作为任务名；v8.3.288+ 消费，此前识别后未用） */
  title?: string;
  /** 描述列（若表头识别到，作为任务描述主体；v8.3.288+） */
  desc?: string;
  /** 涉及端列（若表头识别到，「所有端」/「api,web」） */
  platforms?: string;
  /** Bug 编号列（若表头识别到；留空则导入时自动生成 YYYYMMDD-XXXX） */
  bugId?: string;
  /** 提出人列（若表头识别到，区别于负责人=处理人） */
  reporter?: string;
  /** 负责人列（若表头识别到，作为任务处理人写入 .meta/owner） */
  owner?: string;
}

/** 表头列名 → 字段 的模糊匹配规则（先精确后宽松） */
const COLUMN_HINTS: Record<string, RegExp> = {
  priority: /优先级|优先|priority|紧急程度|等级|level|p\d/i,
  severity: /严重度|严重程度|severity|s\d/i,
  module: /所属模块|功能模块|模块|子系统|feature|module/i,
  // v8.3.288+: desc 先于 title 检测——「Bug 描述」列含「Bug」，若 title 先测 会被
  // /bug/i 抢走误当标题列；描述类词与标题列互斥，先测 desc 不会误伤「Bug 标 题」
  desc: /描述|说明|详情|现象|复现|description|detail|desc/i,
  // v8.3.288+: bugId 先于 title 检测——「Bug 编号」含「Bug」，防被 title 的 /bug/i 抢
  bugId: /缺陷编号|缺陷.?id|bug.?编号|bug.?id|issue.?id|^编号$|^id$/i,
  title: /标题|名称|问题|摘要|主题|缺陷名|title|name|bug/i,
  // v8.3.288+: 涉及端列（「所有端」/「api,web」），决定该任务的端子任务集
  platforms: /涉及端|影响端|端范围|所有端|所属端|平台|platforms?|platform/i,
  // v8.3.288+: 提出人列（区别于「负责人」=处理人；整词匹配防误伤）
  reporter: /提出人|报告人|提交人|上报人|发现人|reporter|creator/i,
  // v8.3.288+: 负责人列（处理人，写入 .meta/owner；排在 reporter 后防「提出人」被抢）
  owner: /负责人|处理人|指派给|分配给|owner|assignee/i,
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
        if (colHints[field] !== undefined) continue;
        // v8.3.288+: 列独占——该列已被其他字段占用则跳过，
        // 防「Bug 编号/Bug 描述」含「Bug」被 title 的 /bug/i 同时抢走
        if (Object.values(colHints).includes(colNumber)) continue;
        if (re.test(text)) {
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
        title: get('title'),
        desc: get('desc'),
        platforms: get('platforms'),
        bugId: get('bugId'),
        reporter: get('reporter'),
        owner: get('owner'),
      });
    });

    return rows;
  } catch {
    return null;
  }
}

/**
 * 纯文本回退：用 exceljs 读 Excel，只拿单元格文本（无图片）
 * 供结构化解析失败时的降级路径
 * （v8.3.288 前用 xlsx 库，但 xlsx 从未进入 package.json，回退链实际是断的——
 *  exceljs 缺失时这里也必然失败；统一改为 exceljs）
 */
export async function extractExcelTextOnly(filePath: string): Promise<string[] | null> {
  let ExcelJS: any;
  try {
    ExcelJS = require('exceljs');
  } catch {
    return null;
  }
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return null;
    const rows: string[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
      if (rowNumber <= 1) return; // 跳过表头
      const texts: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell: any) => {
        const t = cellText(cell.value).trim();
        if (t) texts.push(t);
      });
      if (texts.length > 0) rows.push(texts.join(' — '));
    });
    return rows;
  } catch {
    return null;
  }
}
