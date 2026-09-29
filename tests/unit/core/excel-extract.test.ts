/**
 * Excel bug 导入解析回归基线（v8.3.288+）
 *
 * 覆盖：列头模糊识别（标题/描述/所属模块/涉及端/优先级/严重度）、
 * 「所有端」值透传、无端列时 platforms 为 undefined、
 * 标题/描述列被消费（v8.3.288 前是死代码，任务名退化为整行拼接）。
 */

import { describe, it, expect, afterAll } from 'vitest';
import { rm } from 'fs/promises';
import { join } from 'path';
import { extractExcelBugs, extractExcelTextOnly } from '../../../src/core/excel-extract';

const tmpFiles: string[] = [];

async function makeXlsx(header: string[], rows: string[][]): Promise<string> {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('bug-import');
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  const file = join(require('os').tmpdir(), `bug-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xlsx`);
  await wb.xlsx.writeFile(file);
  tmpFiles.push(file);
  return file;
}

afterAll(async () => {
  for (const f of tmpFiles) await rm(f, { force: true });
});

describe('extractExcelBugs 列识别与消费（v8.3.288）', () => {
  it('识别标准模板列：标题/描述/模块/涉及端/优先级/严重度/编号/提出人/负责人', async () => {
    const file = await makeXlsx(
      ['Bug 编号', 'Bug 标题', 'Bug 描述', '所属模块', '涉及端', '优先级', '严重度', '提出人', '负责人'],
      [
        ['20260928-4821', '支付回调异常', '现象：订单状态不同步。期望：10s 内同步', '支付模块', '所有端', 'P1', 'S1', '小王(测试)', '张三'],
        ['20260928-4822', '登录超时', '复现：弱网环境必现', '登录模块', 'api,web', 'P2', 'S2', '小李(测试)', ' 李四'],
      ],
    );
    const bugs = await extractExcelBugs(file);
    expect(bugs).not.toBeNull();
    expect(bugs!.length).toBe(2);
  
    expect(bugs![0].bugId).toBe('20260928-4821');
    expect(bugs![0].title).toBe('支付回调异常');
    expect(bugs![0].desc).toContain('订单状态不同步');
    expect(bugs![0].module).toBe('支付模块');
    expect(bugs![0].platforms).toBe('所有端');
    expect(bugs![0].priority).toBe('P1');
    expect(bugs![0].severity).toBe('S1');
    expect(bugs![0].reporter).toBe('小王(测试)');
    expect(bugs![0].owner).toBe('张三');
  
    expect(bugs![1].bugId).toBe('20260928-4822');
    expect(bugs![1].platforms).toBe('api,web');
    expect(bugs![1].module).toBe('登录模块');
    expect(bugs![1].reporter).toBe('小李(测试)');
    expect(bugs![1].owner).toBe('李四');
  });
  
  it('编号/提出人/负责人列缺失时回退 undefined（不误伤标题列）', async () => {
    const file = await makeXlsx(
      ['Bug 标题', 'Bug 描述'],
      [['扫码签到白屏', '扫码后页面空白']],
    );
    const bugs = await extractExcelBugs(file);
    expect(bugs![0].title).toBe('扫码签到白屏');
    expect(bugs![0].desc).toBe('扫码后页面空白');
    expect(bugs![0].bugId).toBeUndefined();
    expect(bugs![0].reporter).toBeUndefined();
    expect(bugs![0].owner).toBeUndefined();
  });

  it('英文列名同样可识别', async () => {
    const file = await makeXlsx(
      ['Title', 'Description', 'Module', 'Platforms', 'Priority', 'Severity'],
      [['Bug A', 'desc A', '订单模块', '所有端', 'P0', 'S0']],
    );
    const bugs = await extractExcelBugs(file);
    expect(bugs).not.toBeNull();
    expect(bugs![0].title).toBe('Bug A');
    expect(bugs![0].desc).toBe('desc A');
    expect(bugs![0].module).toBe('订单模块');
    expect(bugs![0].platforms).toBe('所有端');
  });

  it('缺列时对应字段为 undefined，cells 兜底不丢内容', async () => {
    const file = await makeXlsx(
      ['Bug 标题', 'Bug 描述'],
      [['只有标题和描述', '描述内容']],
    );
    const bugs = await extractExcelBugs(file);
    expect(bugs).not.toBeNull();
    expect(bugs![0].title).toBe('只有标题和描述');
    expect(bugs![0].desc).toBe('描述内容');
    expect(bugs![0].module).toBeUndefined();
    expect(bugs![0].platforms).toBeUndefined();
    expect(bugs![0].priority).toBeUndefined();
    expect(bugs![0].severity).toBeUndefined();
    expect(bugs![0].cells.length).toBeGreaterThan(0);
  });

  it('「涉及端」列名变体可识别（影响端/平台）', async () => {
    const file = await makeXlsx(
      ['标题', '描述', '影响端'],
      [['Bug C', 'desc C', 'web']],
    );
    const bugs = await extractExcelBugs(file);
    expect(bugs).not.toBeNull();
    expect(bugs![0].platforms).toBe('web');
  });
});

describe('extractExcelTextOnly 纯文本回退', () => {
  it('无 exceljs 结构化时仍能取到行文本', async () => {
    const file = await makeXlsx(
      ['Bug 标题', 'Bug 描述'],
      [['Bug D', 'desc D']],
    );
    const rows = await extractExcelTextOnly(file);
    expect(rows).not.toBeNull();
    expect(rows![0]).toContain('Bug D');
  });
});
