/**
 * project-cards 单元测试（v8.3.347+）
 *
 * 覆盖「模糊端名 → 项目信息映射」的三级匹配：
 * - 端名（词边界，含复合名分段：H5端 → h5-mobile）
 * - 业务名/项目名（中文 contains，长度 ≥2）
 * - 类型词（前端 → 全部 frontend 端；后端 → 全部 backend 端）
 * 以及名片格式化、AGENTS.md 速查区、PROJECTS.md 落盘。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  matchProjectsFromText,
  formatCardLine,
  formatProjectCardInjection,
  buildQuickIndex,
  writeGlobalProjectsDoc,
} from '../../../src/core/project-cards';
import { PlatformConfig } from '../../../src/core/unified-config';

/** 模拟多端项目的标准配置（booking-service / admin-web / h5-mobile / miniapp / app） */
const PLATFORMS: PlatformConfig[] = [
  { name: 'booking-service', type: 'backend', description: '预订服务', project_name: '预订服务',
    code_path: './backend/booking-service', git_repo: 'git@github.com:org/booking-service.git', default_branch: 'main' },
  { name: 'admin-web', type: 'frontend', description: '管理后台', project_name: '预订管理后台',
    code_path: './frontend/admin-web', git_repo: 'git@github.com:org/admin-web.git', default_branch: 'main' },
  { name: 'h5-mobile', type: 'frontend', description: 'H5移动端', project_name: 'H5移动端',
    code_path: './frontend/h5-mobile', git_repo: 'git@github.com:org/h5-mobile.git', default_branch: 'develop' },
  { name: 'miniapp', type: 'frontend', description: '小程序', project_name: '小程序端',
    code_path: './frontend/miniapp', git_repo: 'git@github.com:org/miniapp.git', default_branch: 'main' },
  { name: 'app', type: 'frontend', description: 'App客户端', project_name: '移动App',
    code_path: './frontend/app', git_repo: 'git@github.com:org/app.git', default_branch: 'main' },
];

describe('matchProjectsFromText — 三级匹配', () => {
  it('端名精确命中（词边界）', () => {
    const hits = matchProjectsFromText('booking-service 接口报错了', PLATFORMS);
    expect(hits.map(h => h.name)).toEqual(['booking-service']);
  });

  it('短端名不误中长词：app 不误中 application', () => {
    const hits = matchProjectsFromText('application 配置有问题', PLATFORMS);
    expect(hits.map(h => h.name)).not.toContain('app');
  });

  it('复合端名分段命中：H5端/H5 → h5-mobile', () => {
    expect(matchProjectsFromText('H5端 页面白屏', PLATFORMS).map(h => h.name)).toEqual(['h5-mobile']);
    expect(matchProjectsFromText('H5 有 bug', PLATFORMS).map(h => h.name)).toEqual(['h5-mobile']);
  });

  it('业务名中文全量命中：预订服务', () => {
    // 「预订」同时是 booking-service（预订服务）与 admin-web（预订管理后台）的滑窗子串
    const hits = matchProjectsFromText('帮我看看预订服务的代码', PLATFORMS);
    expect(hits.map(h => h.name)).toEqual(['booking-service', 'admin-web']);
  });

  it('业务名模糊命中：部分说法（预订/后台/移动端）', () => {
    expect(matchProjectsFromText('预订出问题了', PLATFORMS).map(h => h.name))
      .toEqual(['booking-service', 'admin-web']);
    expect(matchProjectsFromText('后台的权限要改', PLATFORMS).map(h => h.name)).toEqual(['admin-web']);
    // 「移动端」命中 h5-mobile（H5移动端），不误中 app（移动App 的「移动」段 <3 字不参与）
    expect(matchProjectsFromText('移动端样式乱了', PLATFORMS).map(h => h.name)).toEqual(['h5-mobile']);
  });

  it('归一化容差：大小写/空格/连字符不影响命中', () => {
    expect(matchProjectsFromText('h5 移动端 有 bug', PLATFORMS).map(h => h.name)).toEqual(['h5-mobile']);
    expect(matchProjectsFromText('H5-移动端 白屏', PLATFORMS).map(h => h.name)).toEqual(['h5-mobile']);
    expect(matchProjectsFromText('BOOKING 接口报错', PLATFORMS).map(h => h.name)).toEqual(['booking-service']);
  });

  it('类型词「前端」→ 全部 frontend 端并行命中', () => {
    const hits = matchProjectsFromText('前端有个样式问题', PLATFORMS);
    expect(hits.map(h => h.name).sort()).toEqual(['admin-web', 'app', 'h5-mobile', 'miniapp'].sort());
  });

  it('类型词「后端」→ 全部 backend 端并行命中', () => {
    const hits = matchProjectsFromText('后端的接口要改', PLATFORMS);
    expect(hits.map(h => h.name)).toEqual(['booking-service']);
  });

  it('一句话多个端名并行命中，保持声明顺序', () => {
    const hits = matchProjectsFromText('预订服务和小程序的联调有问题', PLATFORMS);
    expect(hits.map(h => h.name)).toEqual(['booking-service', 'admin-web', 'miniapp']);
  });

  it('置信度分级：全量/端名/类型词 = exact，滑窗部分提及 = partial（疑似）', () => {
    // 端名直接命中 → exact
    expect(matchProjectsFromText('booking-service 报错', PLATFORMS)[0].confidence).toBe('exact');
    // 业务名全量 → exact
    expect(matchProjectsFromText('帮我看看预订服务的代码', PLATFORMS)[0].confidence).toBe('exact');
    // 类型词 → exact
    expect(matchProjectsFromText('后端接口要改', PLATFORMS)[0].confidence).toBe('exact');
    // 滑窗 2 字部分提及 → partial
    const partial = matchProjectsFromText('预订出问题了', PLATFORMS);
    expect(partial.map(h => h.confidence)).toEqual(['partial', 'partial']);
    // 「后台」→ 管理后台 滑窗 → partial
    expect(matchProjectsFromText('后台的权限要改', PLATFORMS)[0].confidence).toBe('partial');
  });

  it('无关话题零命中：数据库连接超时', () => {
    expect(matchProjectsFromText('数据库连接超时了', PLATFORMS)).toEqual([]);
  });

  it('未提到任何项目 → 零注入（空数组）', () => {
    expect(matchProjectsFromText('跑一下冒烟测试', PLATFORMS)).toEqual([]);
    expect(matchProjectsFromText('', PLATFORMS)).toEqual([]);
    expect(matchProjectsFromText('随便聊聊', [])).toEqual([]);
  });
});

describe('名片格式化', () => {
  it('formatCardLine 含业务名/源码/Git/分支', () => {
    const line = formatCardLine({
      name: 'booking-service', type: 'backend', businessName: '预订服务',
      codePath: './backend/booking-service', gitRepo: 'git@github.com:org/booking-service.git', defaultBranch: 'main',
    });
    expect(line).toContain('booking-service');
    expect(line).toContain('预订服务');
    expect(line).toContain('./backend/booking-service');
    expect(line).toContain('（main）');
  });

  it('formatProjectCardInjection 多端各一行 + 按需提示', () => {
    const hits = matchProjectsFromText('预订服务和小程序', PLATFORMS);
    const block = formatProjectCardInjection(hits);
    expect(block).toContain('📇 项目信息');
    expect(block).toContain('booking-service');
    expect(block).toContain('miniapp');
    expect(block).toContain('.speccore/GLOBAL/PROJECTS.md');
  });

  it('疑似端带⚠️标注并引导核实；确定端无标注', () => {
    const partial = formatProjectCardInjection(matchProjectsFromText('预订出问题了', PLATFORMS));
    expect(partial).toContain('⚠️疑似');
    expect(partial).toContain('请结合上下文核实');
    const exact = formatProjectCardInjection(matchProjectsFromText('booking-service 报错', PLATFORMS));
    expect(exact).not.toContain('⚠️疑似');
    expect(exact).toContain('按需 Read `.speccore/GLOBAL/PROJECTS.md`');
  });

  it('formatProjectCardInjection 空命中返回空串', () => {
    expect(formatProjectCardInjection([])).toBe('');
  });

  it('buildQuickIndex 每端一行表格', () => {
    const index = buildQuickIndex(PLATFORMS);
    expect(index).toContain('## 项目速查');
    expect(index).toContain('booking-service');
    expect(index).toContain('h5-mobile');
    expect(index.split('\n').filter(l => l.startsWith('|')).length).toBe(PLATFORMS.length + 2);
    expect(buildQuickIndex([])).toBe('');
  });
});

describe('writeGlobalProjectsDoc — PROJECTS.md 落盘', () => {
  it('生成全量名片文件并返回路径', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speccore-cards-'));
    const docPath = await writeGlobalProjectsDoc(tmp, PLATFORMS);
    expect(docPath).toBe(path.join(tmp, '.speccore', 'GLOBAL', 'PROJECTS.md'));
    const content = fs.readFileSync(docPath!, 'utf-8');
    expect(content).toContain('| 端名 | 业务名 | 类型 | 源码路径 | Git 仓库 | 默认分支 |');
    for (const p of PLATFORMS) expect(content).toContain(p.name);
    fs.removeSync(tmp);
  });

  it('无端配置时静默返回 null 不落盘', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'speccore-cards-'));
    expect(await writeGlobalProjectsDoc(tmp, [])).toBeNull();
    fs.removeSync(tmp);
  });
});
