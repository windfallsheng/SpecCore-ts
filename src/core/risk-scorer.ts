/**
 * risk-scorer — 任务风险评分 + 详细报告
 */
import { readFile, pathExists } from 'fs-extra';

export interface RiskItem {
  category: string;       // 风险类别
  level: '🔴' | '🟡' | '🟢';
  description: string;     // 风险描述
  mitigation: string;      // 缓解建议
  source: '需求' | '源码';  // 来源
}

export interface RiskScore {
  level: '🔴 high' | '🟡 medium' | '🟢 low';
  score: number;
  tags: string[];
  reasons: string[];
  items: RiskItem[];       // 详细风险项
  codeRisks: RiskItem[];   // 源码层面的风险
}

/**
 * 根据任务需求内容 + 已有源码自动评分
 */
export async function scoreRisk(content: string, taskName: string, iterationDir?: string): Promise<RiskScore> {
  let score = 0;
  const tags: string[] = [];
  const reasons: string[] = [];
  const items: RiskItem[] = [];

  // ── 高风险: 支付/资金 ──
  if (content.match(/支付|退款|转账|提现|余额|钱包|金额|价格|账单/)) {
    score += 30;
    tags.push('💰 支付');
    reasons.push('涉及支付/资金操作');
    items.push({
      category: '支付安全',
      level: '🔴',
      description: '涉及资金交易，任何错误都可能导致资损',
      mitigation: '必须双人审查 + 充分测试覆盖 + 添加资金操作日志',
      source: '需求',
    });
  }

  // ── 高风险: 权限/认证 ──
  if (content.match(/权限|角色|RBAC|认证|授权|登录|token|OAuth|JWT|鉴权/)) {
    score += 25;
    tags.push('🔐 权限');
    reasons.push('涉及权限/认证变更');
    items.push({
      category: '权限控制',
      level: '🔴',
      description: '权限变更可能造成越权访问',
      mitigation: '逐接口检查权限注解 + 补充越权测试用例',
      source: '需求',
    });
  }

  // ── 高风险: 数据删除 ──
  if (content.match(/DELETE\s*\|/) || content.match(/物理删除|硬删除|cascade/)) {
    score += 20;
    items.push({
      category: '数据安全',
      level: '🔴',
      description: '物理删除操作不可逆',
      mitigation: '建议改用软删除 + 回收站机制, 生产环境禁止物理删除',
      source: '需求',
    });
  }

  // ── 中风险: 批量操作 ──
  if (content.match(/批量删除|批量操作|批量导入|批量更新|全选/)) {
    score += 20;
    tags.push('📦 批量');
    reasons.push('批量操作有数据风险');
    items.push({
      category: '批量操作',
      level: '🟡',
      description: '批量操作可能影响大量数据',
      mitigation: '添加批量限制(≤1000) + 异步处理 + 操作确认弹窗',
      source: '需求',
    });
  }

  // ── 中风险: 导出/报表 ──
  if (content.match(/导出|报表|Excel|CSV|下载|文件生成/)) {
    score += 15;
    tags.push('📊 导出');
    reasons.push('大数据量导出需注意性能');
    items.push({
      category: '性能',
      level: '🟡',
      description: '大数据量导出可能拖垮服务',
      mitigation: '异步导出 + 分页查询 + 文件压缩 + 24h自动清理',
      source: '需求',
    });
  }

  // ── 中风险: 涉及数据库变更 ──
  if (content.match(/数据表|ALTER|建表|索引|迁移|数据迁移|DDL/)) {
    score += 15;
    tags.push('🗄️ DB');
    reasons.push('涉及数据库结构变更');
    items.push({
      category: '数据库变更',
      level: '🟡',
      description: '数据库结构变更可能影响已有功能',
      mitigation: '先在测试环境验证 + 写好回滚脚本 + 非高峰期执行',
      source: '需求',
    });
  }

  // ── 中风险: 外部依赖 ──
  if (content.match(/第三方|外部API|回调|webhook|消息队列|Kafka|MQ/)) {
    score += 10;
    tags.push('🔗 外部依赖');
    reasons.push('涉及外部系统集成');
    items.push({
      category: '外部依赖',
      level: '🟡',
      description: '外部系统不可用时本功能也会受影响',
      mitigation: '添加超时(5s) + 熔断降级 + 重试机制 + 监控告警',
      source: '需求',
    });
  }

  // ── 低风险标记 ──
  const crud = content.match(/\| (GET|POST|PUT|DELETE) \|/) || [];
  if (crud.length >= 2 && score < 20) {
    tags.push('📋 CRUD');
    items.push({
      category: '通用 CRUD',
      level: '🟢',
      description: '标准增删改查，风险较低',
      mitigation: '注意输入校验 + 异常处理',
      source: '需求',
    });
  }

  if (score < 15) {
    tags.push('🟢 低风险');
  }

  // ── 源码层面的风险检测 ──
  const codeRisks = await detectCodeRisks(iterationDir, taskName);

  const level = score >= 30 ? '🔴 high' : score >= 15 ? '🟡 medium' : '🟢 low';
  return { level, score, tags, reasons, items, codeRisks };
}

/**
 * 检测源码层面的风险（从已有关联代码中分析）
 */
async function detectCodeRisks(iterationDir?: string, taskName?: string): Promise<RiskItem[]> {
  if (!iterationDir || !taskName) return [];
  
  const risks: RiskItem[] = [];
  
  // 检查 TECH.md 中的选型是否有已知风险
  const techPath = `.speccore/iterations/${iterationDir}/${taskName}/backend/TECH.md`;
  const altTechPath = `${iterationDir}/${taskName}/backend/TECH.md`;
  
  let techContent = '';
  try {
    if (await pathExists(techPath)) techContent = await readFile(techPath, 'utf-8');
    else if (await pathExists(altTechPath)) techContent = await readFile(altTechPath, 'utf-8');
  } catch {}

  if (techContent) {
    // 检测到 N+1 查询风险
    if (techContent.match(/for\s*\(.*\)\s*\{|forEach.*\.find|循环.*查询/)) {
      risks.push({
        category: '性能',
        level: '🟡',
        description: '代码中可能存在 N+1 查询问题',
        mitigation: '使用 JOIN 查询或批量查询代替循环中的单条查询',
        source: '源码',
      });
    }

    // 检测到未处理的异常
    if (techContent.match(/\.catch\s*\(\s*\)|catch\s*\{\s*\}/)) {
      risks.push({
        category: '异常处理',
        level: '🟡',
        description: '存在空异常捕获，可能吞掉错误信息',
        mitigation: '添加错误日志记录 + 统一异常处理中间件',
        source: '源码',
      });
    }
  }

  return risks;
}

/**
 * 生成详细风险报告（Markdown）
 */
export function generateRiskReport(risk: RiskScore): string {
  let md = `# 风险评估\n\n`;
  md += `- **风险等级**: ${risk.level}\n`;
  md += `- **风险评分**: ${risk.score}/100\n`;
  md += `- **风险标签**: ${risk.tags.join(', ') || '无'}\n\n`;

  const allItems = [...risk.items, ...risk.codeRisks];
  if (allItems.length === 0) {
    md += '✅ 未检测到明显风险\n';
    return md;
  }

  md += `## 风险详情 (${allItems.length} 项)\n\n`;
  md += `| 等级 | 类别 | 描述 | 缓解建议 | 来源 |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  for (const item of allItems) {
    md += `| ${item.level} | ${item.category} | ${item.description} | ${item.mitigation} | ${item.source} |\n`;
  }

  md += `\n---\n> 💡 高风险项建议在开发前 Review，中风险项开发时注意缓解措施\n`;
  return md;
}
