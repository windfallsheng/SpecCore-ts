/**
 * dashboard - 生成可视化仪表盘命令
 * 基于全量层数据生成静态 HTML 仪表盘，含 Chart.js 图表
 */

import { logger, Spinner } from '../utils/logger';
import { readGlobalIndex } from '../core/global-layer';
import { writeFile } from 'fs-extra';
import { FileTransaction } from '../core/transaction';
import { join } from 'path';

export interface DashboardOptions {
  output?: string;
}

export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  const spinner = new Spinner('采集全量层数据...');
  spinner.start();

  try {
    const index = await readGlobalIndex();

    if (index.projects.length === 0 && index.reqs.length === 0) {
      spinner.fail('全量层为空，无法生成仪表盘。请先导入项目。');
      return;
    }

    spinner.stop('数据采集完成，正在生成仪表盘...');

    // 统计数据
    const totalReqs = index.reqs.length;
    const implemented = index.reqs.filter((r) =>
      r.status === '✅ 已实现' || r.status === '📦 已有实现'
    ).length;
    const inProgress = index.reqs.filter((r) => r.status === '🔄 进行中').length;
    const pending = totalReqs - implemented - inProgress;
    const completionRate = totalReqs > 0 ? Math.round((implemented / totalReqs) * 100) : 0;

    // 项目分布数据
    const projectLabels = index.projects.map((p) => p.name);
    const projectReqs = index.projects.map((p) => p.reqCount);

    // 生成 HTML
    const html = generateDashboardHtml(
      index.projects.length,
      totalReqs,
      implemented,
      inProgress,
      pending,
      completionRate,
      projectLabels,
      projectReqs,
      index
    );

    const outputPath = options.output || join(process.cwd(), 'speccore-dashboard.html');
    await writeFile(outputPath, html);

    logger.info('');
    logger.success('✅ 仪表盘已生成！');
    logger.info('');
    logger.info(`📁 输出文件: ${outputPath}`);
    logger.info('');
    logger.info('📊 包含内容:');
    logger.info('   - 统计卡片：总需求、已实现、进行中、待开发');
    logger.info('   - 需求状态分布（饼图）');
    logger.info('   - 项目需求分布（柱状图）');
    logger.info('   - 项目详细列表');
    logger.info('   - 期次关联状态');
    logger.info('');
    logger.info('💡 在浏览器中打开即可查看。支持移动端自适应布局。');
  } catch (error) {
    spinner.fail(`生成仪表盘失败: ${error}`);
    throw error;
  }
}

function generateDashboardHtml(
  projectCount: number,
  totalReqs: number,
  implemented: number,
  inProgress: number,
  pending: number,
  completionRate: number,
  projectLabels: string[],
  projectReqs: number[],
  index: Awaited<ReturnType<typeof readGlobalIndex>>
): string {
  const now = new Date().toISOString().split('T')[0];

  // 生成项目表格行
  let projectRows = '';
  for (const proj of index.projects) {
    projectRows += `<tr><td>${proj.name}</td><td><span class="badge badge-${proj.type}">${proj.type}</span></td><td>${proj.reqCount}</td><td>${proj.lastImport}</td></tr>`;
  }

  // 生成需求表格行
  let reqRows = '';
  for (const req of index.reqs.slice(0, 20)) {
    const statusClass = req.status.includes('✅') ? 'done' : req.status.includes('🔄') ? 'progress' : 'pending';
    reqRows += `<tr><td>${req.id}</td><td>${req.name}</td><td>${req.project}</td><td><span class="badge badge-${statusClass}">${req.status}</span></td><td>${req.iteration || '-'}</td></tr>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecCore 项目仪表盘</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', sans-serif; background: #f0f2f5; padding: 24px; color: #1a1a2e; }
.container { max-width: 1400px; margin: 0 auto; }
.header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 28px 32px; border-radius: 16px; margin-bottom: 24px; }
.header h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
.header .meta { opacity: 0.6; margin-top: 6px; font-size: 14px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); text-align: center; }
.stat-card .label { font-size: 13px; color: #64748b; margin-bottom: 8px; font-weight: 500; }
.stat-card .value { font-size: 36px; font-weight: 800; letter-spacing: -1px; }
.stat-card .sub { font-size: 13px; color: #94a3b8; margin-top: 4px; }
.stat-card .value.green { color: #22c55e; }
.stat-card .value.blue { color: #3b82f6; }
.stat-card .value.amber { color: #f59e0b; }
.stat-card .value.gray { color: #64748b; }
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
@media (max-width: 768px) { .charts { grid-template-columns: 1fr; } .stats { grid-template-columns: 1fr 1fr; } }
.chart-card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.chart-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #334155; }
.chart-card canvas { max-height: 300px; }
.full { grid-column: 1 / -1; }
.table-card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 24px; overflow-x: auto; }
.table-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #334155; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
thead tr { border-bottom: 2px solid #e2e8f0; }
th { text-align: left; padding: 10px 8px; color: #64748b; font-weight: 600; font-size: 13px; }
td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
.badge-backend { background: #dbeafe; color: #1e40af; }
.badge-web { background: #dcfce7; color: #166534; }
.badge-h5 { background: #fef3c7; color: #92400e; }
.badge-miniapp { background: #f3e8ff; color: #6b21a8; }
.badge-done { background: #dcfce7; color: #166534; }
.badge-progress { background: #dbeafe; color: #1e40af; }
.badge-pending { background: #f1f5f9; color: #64748b; }
.footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; padding: 16px; }
</style>
</head>
<body>
<div class="container">
<div class="header">
  <h1>📊 SpecCore 项目仪表盘</h1>
  <div class="meta">生成时间: ${now} | 全量层版本: ${index.version} | 项目数: ${projectCount}</div>
</div>

<div class="stats">
  <div class="stat-card">
    <div class="label">📋 总需求数</div>
    <div class="value blue">${totalReqs}</div>
    <div class="sub">${projectCount} 个项目</div>
  </div>
  <div class="stat-card">
    <div class="label">✅ 已完成</div>
    <div class="value green">${implemented}</div>
    <div class="sub">完成率 ${completionRate}%</div>
  </div>
  <div class="stat-card">
    <div class="label">🔄 进行中</div>
    <div class="value amber">${inProgress}</div>
    <div class="sub">${Math.round((inProgress/(totalReqs||1))*100)}%</div>
  </div>
  <div class="stat-card">
    <div class="label">🔲 待开发</div>
    <div class="value gray">${pending}</div>
    <div class="sub">${Math.round((pending/(totalReqs||1))*100)}%</div>
  </div>
</div>

<div class="charts">
  <div class="chart-card">
    <h3>📊 需求状态分布</h3>
    <canvas id="statusChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>📈 项目需求分布</h3>
    <canvas id="projectChart"></canvas>
  </div>
</div>

<div class="table-card">
  <h3>📋 项目列表</h3>
  <table>
    <thead><tr><th>项目名称</th><th>类型</th><th>需求数</th><th>最后导入</th></tr></thead>
    <tbody>${projectRows || '<tr><td colspan="4">暂无项目</td></tr>'}</tbody>
  </table>
</div>

<div class="table-card">
  <h3>📝 需求详情</h3>
  <table>
    <thead><tr><th>需求 ID</th><th>名称</th><th>项目</th><th>状态</th><th>关联期次</th></tr></thead>
    <tbody>${reqRows || '<tr><td colspan="5">暂无需求</td></tr>'}</tbody>
  </table>
</div>

<div class="footer">Powered by SpecCore | Generated ${now}</div>
</div>

<script>
new Chart(document.getElementById('statusChart'), {
  type: 'doughnut',
  data: {
    labels: ['已实现', '进行中', '待开发'],
    datasets: [{
      data: [${implemented}, ${inProgress}, ${pending}],
      backgroundColor: ['#22c55e', '#3b82f6', '#e2e8f0'],
      borderWidth: 2,
      borderColor: '#fff'
    }]
  },
  options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
});

new Chart(document.getElementById('projectChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(projectLabels)},
    datasets: [{
      label: '需求数',
      data: ${JSON.stringify(projectReqs)},
      backgroundColor: '#3b82f6',
      borderRadius: 8
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
  }
});
</script>
</body>
</html>`;
}
