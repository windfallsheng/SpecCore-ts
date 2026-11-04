/**
 * 任务角色解析器 — v8.3.389+
 *
 * 综合「任务类型 × 任务内容 × 用户意图」匹配执行角色：
 * - 主角色（primary）：决定代码生成/调研产出的视角，支持平台特化后缀
 * - 辅助角色（assistants）：内容关键词命中时附加的专业审查视角（一个或多个）
 *
 * 设计约束（多消费点一致性）：execute/taskify 等命令的选角必须统一走本解析器，
 * 禁止各命令自写类型映射——否则「类型×角色」判定在多处漂移，重蹈
 * 「单点修复在多消费点架构下漏网」的覆辙。
 */

export interface TaskAgentResolution {
  /** 主角色名（已含平台特化后缀，如 bug-analyzer-admin-web） */
  primary: string;
  /** 辅助角色名列表（不含平台后缀的通用角色名） */
  assistants: string[];
}

export interface ResolveTaskAgentsOptions {
  /** 任务类型：feature / bugfix / refactor / research（.meta/type 权威值） */
  taskType?: string;
  /** 任务名/功能单元名（内容维度：关键词命中辅助角色） */
  taskName?: string;
  /** 任务描述补充（与 taskName 合并做关键词扫描） */
  taskDesc?: string;
  /** 端名（平台特化后缀，如 admin-web → bug-analyzer-admin-web） */
  platform?: string;
  /** 用户意图（ask-engine WORKFLOWS 键，如 'bugfix' / 'code review'） */
  intent?: string;
}

/** 任务类型 → 主角色基名映射（唯一事实源，禁止在命令层重写） */
const TYPE_PRIMARY_AGENT: Record<string, string> = {
  feature: 'code-generator',
  bugfix: 'bug-analyzer',
  refactor: 'refactor-architect',
  research: 'research-analyst',
};

/** 用户意图 → 主角色基名（意图优先于类型，ask-engine WORKFLOWS 键） */
const INTENT_PRIMARY_AGENT: Record<string, string> = {
  'new feature': 'code-generator',
  bugfix: 'bug-analyzer',
  'code review': 'code-reviewer',
};

/** 内容关键词 → 辅助角色（轻量词典；命中即附加，多个可同时附加） */
const CONTENT_ASSISTANT_HINTS: { agent: string; keywords: string[] }[] = [
  {
    agent: 'security-reviewer',
    keywords: ['登录', '鉴权', '权限', '密码', '加密', '支付', '资金', '退款', '安全', 'token', 'auth', 'login', 'password', 'payment', 'pay', '敏感'],
  },
  {
    agent: 'performance-expert',
    keywords: ['性能', '高并发', '慢', '超时', '内存', '泄漏', '缓存', '优化', '并发', 'performance', 'timeout', 'memory', 'cache', 'concurrent', 'oom'],
  },
  {
    agent: 'doc-sync-agent',
    keywords: ['api', '接口', '契约', '对接', '集成', 'contract', 'integration', 'swagger'],
  },
  {
    agent: 'dependency-analyst',
    keywords: ['数据库', '表结构', '迁移', '索引', 'schema', 'migration', 'index', '依赖', '数据源'],
  },
  {
    agent: 'regression-tester',
    keywords: ['兼容', '升级', '迁移', '老版本', 'compatibility', 'upgrade', 'migrate', '回滚'],
  },
];

/**
 * 解析任务执行角色组合
 *
 * 匹配链：意图 > 任务类型 > 默认 code-generator；主角色拼平台特化后缀；
 * 辅助角色按内容关键词命中（排除主角色基名、去重）。
 */
export function resolveTaskAgents(opts: ResolveTaskAgentsOptions): TaskAgentResolution {
  const taskType = (opts.taskType || '').toLowerCase().trim();
  const intent = (opts.intent || '').toLowerCase().trim();

  // 1. 主角色基名：意图 > 类型 > 默认
  let base = 'code-generator';
  if (intent && INTENT_PRIMARY_AGENT[intent]) {
    base = INTENT_PRIMARY_AGENT[intent];
  } else if (taskType && TYPE_PRIMARY_AGENT[taskType]) {
    base = TYPE_PRIMARY_AGENT[taskType];
  }

  // 2. 平台特化后缀（沿用 resolveAgentName 的 `${base}-${platform}` 约定，
  //    与 execute 现有 code-generator-{端} 标记口径一致，不校验存在性）
  const primary = opts.platform && opts.platform !== 'default' ? `${base}-${opts.platform}` : base;

  // 3. 内容关键词 → 辅助角色（排除主角色基名、去重、保序）
  const text = `${opts.taskName || ''} ${opts.taskDesc || ''}`.toLowerCase();
  const assistants: string[] = [];
  for (const hint of CONTENT_ASSISTANT_HINTS) {
    if (assistants.includes(hint.agent)) continue;
    if (hint.agent === base) continue;
    if (hint.keywords.some(k => text.includes(k))) {
      assistants.push(hint.agent);
    }
  }

  return { primary, assistants };
}
