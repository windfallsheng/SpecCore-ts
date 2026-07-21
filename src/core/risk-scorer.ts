/**
 * risk-scorer — 任务风险评分 + 标签
 */

export interface RiskScore {
  level: '🔴 high' | '🟡 medium' | '🟢 low';
  score: number;
  tags: string[];
  reasons: string[];
}

/**
 * 根据任务需求内容自动评分
 */
export function scoreRisk(content: string, taskName: string): RiskScore {
  let score = 0;
  const tags: string[] = [];
  const reasons: string[] = [];

  // ── 高风险: 支付/资金 ──
  if (content.match(/支付|退款|转账|提现|余额|钱包|金额|价格|账单/)) {
    score += 30;
    tags.push('💰 支付');
    reasons.push('涉及支付/资金操作');
  }

  // ── 高风险: 权限/认证 ──
  if (content.match(/权限|角色|RBAC|认证|授权|登录|token|OAuth|JWT|鉴权/)) {
    score += 25;
    tags.push('🔐 权限');
    reasons.push('涉及权限/认证变更');
  }

  // ── 中风险: 批量操作 ──
  if (content.match(/批量删除|批量操作|批量导入|批量更新|全选/)) {
    score += 20;
    tags.push('📦 批量');
    reasons.push('批量操作有数据风险');
  }

  // ── 中风险: 导出/报表 ──
  if (content.match(/导出|报表|Excel|CSV|下载|文件生成/)) {
    score += 15;
    tags.push('📊 导出');
    reasons.push('大数据量导出需注意性能');
  }

  // ── 中风险: 涉及数据库变更 ──
  if (content.match(/数据表|ALTER|建表|索引|迁移|数据迁移|DDL/)) {
    score += 15;
    tags.push('🗄️ DB');
    reasons.push('涉及数据库结构变更');
  }

  // ── 中风险: 外部依赖 ──
  if (content.match(/第三方|外部API|回调|webhook|消息队列|Kafka|MQ/)) {
    score += 10;
    tags.push('🔗 外部依赖');
    reasons.push('涉及外部系统集成');
  }

  // ── 低风险标记 ──
  const crud = content.match(/\| (GET|POST|PUT|DELETE) \|/) || [];
  if (crud.length >= 2 && score < 20) {
    tags.push('📋 CRUD');
  }

  if (score < 15) {
    tags.push('🟢 低风险');
  }

  const level = score >= 30 ? '🔴 high' : score >= 15 ? '🟡 medium' : '🟢 low';
  return { level, score, tags, reasons };
}
