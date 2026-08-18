/**
 * change-parser — 变更文件解析器
 * 将 .md/.txt/.json/.yaml 等格式的变更需求文件解析为结构化数据
 */
import { logger } from '../utils/logger';

// ── 类型定义 ──

/** 变更类别 */
export type ChangeCategory =
  | 'field-change'      // 字段增删改
  | 'api-change'        // 接口增删改
  | 'flow-change'       // 流程变更
  | 'ui-change'         // UI 调整
  | 'logic-change'      // 业务逻辑变更
  | 'config-change'     // 配置变更
  | 'feature'           // 全新功能
  | 'endpoint'          // 新端
  | 'integration'       // 第三方集成
  | 'unknown';          // 未分类

/** 结构化变更需求 */
export interface ChangeRequest {
  title: string;
  description: string;
  type: 'change' | 'new' | 'unknown';
  category: ChangeCategory;
  priority: 'low' | 'medium' | 'high' | 'critical';
  affectedEntities: string[];
  acceptanceCriteria: string[];
  relatedTasks: string[];
  notes: string;
  rawContent: string;   // 原始文件内容（保留用于 AI 分析）
}

// ── 解析函数 ──

/**
 * 根据文件扩展名选择解析器
 */
export function parseChangeFile(fileName: string, content: string): ChangeRequest {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  switch (ext) {
    case 'json':
      return parseJsonChange(content);
    case 'yaml':
    case 'yml':
      return parseYamlChange(content);
    case 'md':
    case 'markdown':
      return parseMarkdownChange(content);
    case 'txt':
    case 'csv':
    default:
      return parseTextChange(content);
  }
}

/**
 * 解析 JSON 格式变更需求
 */
function parseJsonChange(content: string): ChangeRequest {
  try {
    const data = JSON.parse(content);
    return {
      title: data.title || data.name || '未命名变更',
      description: data.description || data.desc || '',
      type: normalizeType(data.type),
      category: normalizeCategory(data.category || data.type),
      priority: normalizePriority(data.priority),
      affectedEntities: Array.isArray(data.affectedEntities) ? data.affectedEntities : [],
      acceptanceCriteria: Array.isArray(data.acceptanceCriteria) ? data.acceptanceCriteria : [],
      relatedTasks: Array.isArray(data.relatedTasks) ? data.relatedTasks : [],
      notes: data.notes || '',
      rawContent: content,
    };
  } catch (e) {
    logger.warn('JSON 解析失败，回退到文本解析');
    return parseTextChange(content);
  }
}

/**
 * 解析 YAML 格式变更需求
 */
function parseYamlChange(content: string): ChangeRequest {
  try {
    // 简单 YAML 解析（只处理键值对，不支持嵌套）
    const data: Record<string, string | string[]> = {};
    const lines = content.split('\n');
    let currentKey = '';
    let currentList: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // 键值对: key: value
      const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
      if (kvMatch) {
        // 保存之前的列表
        if (currentKey && currentList.length > 0) {
          data[currentKey] = currentList;
          currentList = [];
        }
        currentKey = kvMatch[1];
        const value = kvMatch[2].trim();
        if (value) {
          data[currentKey] = value;
        }
        continue;
      }

      // 列表项: - item
      const listMatch = trimmed.match(/^-\s*(.+)$/);
      if (listMatch && currentKey) {
        currentList.push(listMatch[1].trim());
      }
    }

    // 保存最后的列表
    if (currentKey && currentList.length > 0) {
      data[currentKey] = currentList;
    }

    return {
      title: String(data.title || data.name || '未命名变更'),
      description: String(data.description || data.desc || ''),
      type: normalizeType(String(data.type || '')),
      category: normalizeCategory(String(data.category || data.type || '')),
      priority: normalizePriority(String(data.priority)),
      affectedEntities: Array.isArray(data.affectedEntities) ? data.affectedEntities.map(String) : [],
      acceptanceCriteria: Array.isArray(data.acceptanceCriteria) ? data.acceptanceCriteria.map(String) : [],
      relatedTasks: Array.isArray(data.relatedTasks) ? data.relatedTasks.map(String) : [],
      notes: String(data.notes || ''),
      rawContent: content,
    };
  } catch (e) {
    logger.warn('YAML 解析失败，回退到文本解析');
    return parseTextChange(content);
  }
}

/**
 * 解析 Markdown 格式变更需求
 * 尝试提取标题和描述
 */
function parseMarkdownChange(content: string): ChangeRequest {
  const lines = content.split('\n');
  let title = '';
  let description = '';
  let inDescription = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // 提取标题 (# 标题)
    if (!title && trimmed.startsWith('# ')) {
      title = trimmed.replace(/^#\s*/, '').trim();
      continue;
    }

    // 收集描述（第一个非空段落）
    if (!inDescription && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-') && !trimmed.startsWith('|')) {
      inDescription = true;
    }
    if (inDescription) {
      if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
        break;
      }
      description += line + '\n';
    }
  }

  return {
    title: title || '未命名变更',
    description: description.trim() || content.slice(0, 500),
    type: 'unknown',
    category: 'unknown',
    priority: 'medium',
    affectedEntities: [],
    acceptanceCriteria: [],
    relatedTasks: [],
    notes: '',
    rawContent: content,
  };
}

/**
 * 解析纯文本变更需求
 */
function parseTextChange(content: string): ChangeRequest {
  const lines = content.split('\n').filter(l => l.trim());
  const title = lines[0]?.slice(0, 80) || '未命名变更';

  return {
    title,
    description: content.trim(),
    type: 'unknown',
    category: 'unknown',
    priority: 'medium',
    affectedEntities: [],
    acceptanceCriteria: [],
    relatedTasks: [],
    notes: '',
    rawContent: content,
  };
}

// ── 规范化函数 ──

function normalizeType(type: string): 'change' | 'new' | 'unknown' {
  const lower = String(type).toLowerCase();
  if (['change', 'modify', 'update', 'fix', '调整', '修改', '变更'].includes(lower)) return 'change';
  if (['new', 'add', 'create', 'feature', '新增', '添加', '创建'].includes(lower)) return 'new';
  return 'unknown';
}

function normalizeCategory(category: string): ChangeCategory {
  const lower = String(category).toLowerCase();

  // 变更类
  if (['field', 'field-change', '字段', '属性', '列'].some(k => lower.includes(k))) return 'field-change';
  if (['api', 'interface', '接口', 'url', 'endpoint'].some(k => lower.includes(k))) return 'api-change';
  if (['flow', 'process', '流程', '顺序', '步骤'].some(k => lower.includes(k))) return 'flow-change';
  if (['ui', '界面', '样式', '布局', '视觉'].some(k => lower.includes(k))) return 'ui-change';
  if (['logic', 'rule', '逻辑', '规则', '算法'].some(k => lower.includes(k))) return 'logic-change';
  if (['config', 'configuration', '配置', '开关', '阈值'].some(k => lower.includes(k))) return 'config-change';

  // 新增类
  if (['feature', '功能'].some(k => lower.includes(k))) return 'feature';
  if (['endpoint', 'platform', '端', '平台', '渠道'].some(k => lower.includes(k))) return 'endpoint';
  if (['integration', 'integrate', '对接', '接入', '集成'].some(k => lower.includes(k))) return 'integration';

  return 'unknown';
}

function normalizePriority(priority: string | undefined): 'low' | 'medium' | 'high' | 'critical' {
  if (!priority) return 'medium';
  const lower = String(priority).toLowerCase();
  if (['critical', 'p0', 'urgent', '紧急', '严重'].includes(lower)) return 'critical';
  if (['high', 'p1', 'important', '高'].includes(lower)) return 'high';
  if (['low', 'p2', 'minor', '低'].includes(lower)) return 'low';
  return 'medium';
}

// ── 辅助：从描述推断类别（用于纯文本/未分类场景）──

/**
 * 从描述文本推断变更类别（规则层，零成本）
 */
export function inferCategoryFromDescription(desc: string): { type: 'change' | 'new' | 'unknown'; category: ChangeCategory } {
  const lower = desc.toLowerCase();

  // 新增类
  if (/^(新增|增加|添加|创建|实现|做一个|开发)/.test(desc)) {
    if (/端|平台|渠道|小程序|app|h5/.test(lower)) return { type: 'new', category: 'endpoint' };
    if (/对接|接入|集成|同步|回调/.test(lower)) return { type: 'new', category: 'integration' };
    return { type: 'new', category: 'feature' };
  }

  // 变更类
  if (/改|变|调整|优化|修改|替换|删除|去掉|换成/.test(lower)) {
    if (/字段|列|属性|类型|长度|必填/.test(lower)) return { type: 'change', category: 'field-change' };
    if (/接口|api|url|路径|参数|返回值/.test(lower)) return { type: 'change', category: 'api-change' };
    if (/流程|顺序|步骤|跳转|路由/.test(lower)) return { type: 'change', category: 'flow-change' };
    if (/界面|ui|样式|布局|颜色|字体|按钮|弹窗/.test(lower)) return { type: 'change', category: 'ui-change' };
    if (/逻辑|规则|算法|权限|校验/.test(lower)) return { type: 'change', category: 'logic-change' };
    if (/配置|开关|阈值|枚举|常量/.test(lower)) return { type: 'change', category: 'config-change' };
    return { type: 'change', category: 'logic-change' };
  }

  return { type: 'unknown', category: 'unknown' };
}
