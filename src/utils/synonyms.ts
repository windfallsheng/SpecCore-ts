/**
 * 同义词扩展工具
 * v8.3.125+: 从 split.ts 提取为公共模块，供全链路关键词匹配使用
 *
 * 解决的问题：中英文/缩写/不同表述的词汇无法互相匹配
 * 例："登录" 与 "auth" / "login" / "authentication" / "鉴权"
 */

/** 提取并归一化关键词（支持中英文、驼峰拆分） */
export function extractNormalizedKeywords(text: string): string[] {
  const kws = new Set<string>();
  // 驼峰命名拆分: userAuth → user, auth
  for (const m of text.matchAll(/[a-zA-Z][a-z]*[A-Z][a-zA-Z]*/g)) {
    const parts = m[0].replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
    for (const p of parts) if (p.length >= 2) kws.add(p);
  }
  // 普通英文单词
  for (const m of text.matchAll(/[a-zA-Z]+/g)) {
    if (m[0].length >= 2) kws.add(m[0].toLowerCase());
  }
  // 中文词（2字以上）
  for (const m of text.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    kws.add(m[0]);
  }
  // 数字+字母组合
  for (const m of text.matchAll(/\d+[a-zA-Z]+|[a-zA-Z]+\d+/g)) {
    kws.add(m[0].toLowerCase());
  }
  return [...kws];
}

/** 同义词扩展表（覆盖最常见的开发领域词汇） */
export const SYNONYM_GROUPS: string[][] = [
  ['login', 'signin', 'sign-in', '登录', '登陆', '认证', '鉴权', 'auth', 'authentication', 'authorize', 'authorization'],
  ['logout', 'signout', 'sign-out', '登出', '退出'],
  ['register', 'signup', 'sign-up', '注册', ' enrollment'],
  ['user', 'users', 'account', 'accounts', 'member', 'members', '用户', '账号', '账户', '会员'],
  ['order', 'orders', 'booking', 'bookings', '订单', '预约', '预定', '预订'],
  ['payment', 'pay', 'payments', 'checkout', '支付', '付款', '收银', '结算'],
  ['product', 'products', 'goods', 'sku', 'spu', '商品', '产品', '货品'],
  ['cart', 'basket', 'shopping', '购物车', '购物篮'],
  ['inventory', 'stock', 'warehouse', '库存', '仓储', '仓库'],
  ['notification', 'notify', 'message', 'messages', 'push', '通知', '消息', '推送'],
  ['report', 'reports', 'dashboard', '统计', '报表', '仪表盘', '看板'],
  ['permission', 'permissions', 'role', 'roles', 'rbac', 'acl', '权限', '角色', '访问控制'],
  ['config', 'configuration', 'settings', 'setting', '配置', '设置'],
  ['log', 'logs', 'logging', 'logger', '日志', '记录'],
  ['cache', 'caching', '缓存', '高速缓存'],
  ['search', 'query', 'queries', 'filter', '检索', '搜索', '查询', '筛选'],
  ['upload', 'download', 'file', 'files', '上传', '下载', '文件'],
  ['schedule', 'scheduling', 'cron', 'job', 'jobs', 'timer', '定时', '调度', '计划任务'],
  ['workflow', 'process', 'flow', '审批', '流程', '工作流'],
  ['api', 'apis', 'interface', 'interfaces', 'endpoint', 'endpoints', '接口'],
  ['database', 'db', 'data', 'storage', 'store', '数据库', '数据', '存储'],
  ['frontend', 'web', 'h5', 'mobile', 'app', 'ui', '前端', '页面', '移动端'],
  ['backend', 'server', 'service', 'services', '后端', '服务端'],
  ['interceptor', 'interceptors', 'middleware', 'guard', 'guards', 'pipe', 'pipes', 'filter', 'filters', '拦截器', '中间件', '守卫', '管道'],
];

/** 扩展关键词的同义词集合 */
export function expandSynonyms(keywords: string[]): Set<string> {
  const result = new Set(keywords);
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    for (const group of SYNONYM_GROUPS) {
      if (group.some(g => g.toLowerCase() === lower)) {
        for (const g of group) result.add(g.toLowerCase());
      }
    }
  }
  return result;
}

/**
 * 检查两个文本是否存在同义词关联（任意关键词的同义词交集）
 * 用于简单的 yes/no 判断，不需要精确得分
 */
export function hasSynonymOverlap(textA: string, textB: string): boolean {
  const kwsA = expandSynonyms(extractNormalizedKeywords(textA));
  const kwsB = expandSynonyms(extractNormalizedKeywords(textB));
  for (const a of kwsA) {
    for (const b of kwsB) {
      if (a === b || a.includes(b) || b.includes(a)) return true;
    }
  }
  return false;
}

/**
 * 计算两个文本的关键词同义词交集得分
 * 每对匹配 +10 分
 */
export function scoreSynonymOverlap(textA: string, textB: string): number {
  const kwsA = expandSynonyms(extractNormalizedKeywords(textA));
  const kwsB = expandSynonyms(extractNormalizedKeywords(textB));
  let score = 0;
  for (const a of kwsA) {
    for (const b of kwsB) {
      if (a === b || a.includes(b) || b.includes(a)) {
        score += 10;
        break;
      }
    }
  }
  return score;
}
