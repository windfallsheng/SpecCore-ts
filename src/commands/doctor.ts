/**
 * doctor — 项目健康度诊断命令
 * v6.92.0
 */
import { join } from 'path';
import { pathExists, readFile, readdir, stat } from 'fs-extra';
import { logger } from '../utils/logger';
import { findProjectRoot } from '../utils/task-utils';
import { checkLock } from '../core/lock-manager';
import { getNotifications } from '../core/notification';

interface DiagnosisResult {
  ok: boolean;
  category: string;
  message: string;
  fix?: string;
}

export interface DoctorOptions {
  fix?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    logger.error('❌ 未找到项目根目录（缺少 .speccore/ 目录）');
    logger.info('   请先运行: speccore init');
    return;
  }

  logger.info('\n🏥 SpecCore 项目健康度诊断\n');

  const results: DiagnosisResult[] = [];

  // 1. 核心目录结构
  results.push(...(await checkCoreStructure(projectRoot)));

  // 2. CONSTITUTION.md
  results.push(...(await checkConstitution(projectRoot)));

  // 3. 上下文配置
  results.push(...(await checkContext(projectRoot)));

  // 4. 规范数据库完整性
  results.push(...(await checkSpecDatabase(projectRoot)));

  // 5. 代码知识图谱时效性
  results.push(...(await checkCodeGraph(projectRoot)));

  // 6. 迭代目录健康度
  results.push(...(await checkIterations(projectRoot)));

  // 7. PATTERNS 格式规范
  results.push(...(await checkPatterns(projectRoot)));

  // 8. v6.95.0+: 并发锁状态
  results.push(...(await checkLocks(projectRoot)));

  // 9. v6.96.0+: 通知积压
  results.push(...(await checkNotificationBacklog(projectRoot)));

  // 汇总输出
  printSummary(results);
}

async function checkCoreStructure(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const requiredDirs = ['GLOBAL', 'PATTERNS', 'local', 'prompts'];

  for (const dir of requiredDirs) {
    const exists = await pathExists(join(projectRoot, '.speccore', dir));
    results.push({
      ok: exists,
      category: '目录结构',
      message: exists ? `.speccore/${dir}/ 存在` : `.speccore/${dir}/ 缺失`,
      fix: exists ? undefined : `mkdir -p .speccore/${dir}`,
    });
  }

  return results;
}

async function checkConstitution(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const constitutionPath = join(projectRoot, '.speccore', 'CONSTITUTION.md');
  const exists = await pathExists(constitutionPath);

  results.push({
    ok: exists,
    category: 'CONSTITUTION',
    message: exists ? 'CONSTITUTION.md 存在' : 'CONSTITUTION.md 缺失',
    fix: exists ? undefined : 'speccore init --force',
  });

  if (exists) {
    const content = await readFile(constitutionPath, 'utf-8');
    const hasPlatformSection = content.includes('## 端列表');
    const hasTechStack = content.includes('## 技术栈');

    results.push({
      ok: hasPlatformSection,
      category: 'CONSTITUTION',
      message: hasPlatformSection ? '「端列表」章节已定义' : '「端列表」章节缺失',
    });
    results.push({
      ok: hasTechStack,
      category: 'CONSTITUTION',
      message: hasTechStack ? '「技术栈」章节已定义' : '「技术栈」章节缺失',
    });
  }

  return results;
}

async function checkContext(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const contextPath = join(projectRoot, '.speccore', 'local', 'context.json');
  const exists = await pathExists(contextPath);

  results.push({
    ok: exists,
    category: '上下文',
    message: exists ? 'local/context.json 存在' : 'local/context.json 缺失',
  });

  if (exists) {
    try {
      const content = JSON.parse(await readFile(contextPath, 'utf-8'));
      const hasIteration = !!content.currentIteration;
      results.push({
        ok: hasIteration,
        category: '上下文',
        message: hasIteration ? `当前迭代: ${content.currentIteration}` : '未设置当前迭代',
        fix: hasIteration ? undefined : 'speccore context --set --iteration <name>',
      });
    } catch {
      results.push({
        ok: false,
        category: '上下文',
        message: 'context.json 格式损坏（非法 JSON）',
        fix: '删除后重新设置: rm .speccore/local/context.json',
      });
    }
  }

  return results;
}

async function checkSpecDatabase(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const layers = ['AGENTS', 'RULES', 'COMMANDS', 'SKILLS', 'HOOKS'];

  for (const layer of layers) {
    const dirPath = join(projectRoot, '.speccore', layer);
    const exists = await pathExists(dirPath);
    results.push({
      ok: exists,
      category: '规范数据库',
      message: exists ? `.speccore/${layer}/ 已初始化` : `.speccore/${layer}/ 未初始化`,
      fix: exists ? undefined : `speccore init（会自动创建 ${layer}）`,
    });
  }

  return results;
}

async function checkCodeGraph(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const graphPath = join(projectRoot, '.speccore', 'code-graph', 'graph.json');
  const exists = await pathExists(graphPath);

  if (!exists) {
    results.push({
      ok: true,
      category: '代码图谱',
      message: 'graph.json 未生成（可选）',
      fix: 'speccore code-index --graph --scope src',
    });
    return results;
  }

  // 检查时效性
  try {
    const graphStat = await stat(graphPath);
    const srcDir = join(projectRoot, 'src');
    let srcMtime = graphStat.mtime;

    if (await pathExists(srcDir)) {
      const srcStat = await stat(srcDir);
      srcMtime = srcStat.mtime;
      // 简化：只检查 src 目录的修改时间
      const isStale = graphStat.mtime < srcStat.mtime;
      results.push({
        ok: !isStale,
        category: '代码图谱',
        message: isStale
          ? `graph.json 已过期（源码在 ${formatTime(srcStat.mtime)} 后有变更）`
          : 'graph.json 是最新的',
        fix: isStale ? 'speccore code-index --graph --scope src' : undefined,
      });
    }
  } catch {
    results.push({
      ok: false,
      category: '代码图谱',
      message: '无法读取 graph.json 状态',
    });
  }

  return results;
}

async function checkIterations(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const iterDir = join(projectRoot, '.speccore', 'ITERATIONS');

  if (!(await pathExists(iterDir))) {
    results.push({
      ok: true,
      category: '迭代',
      message: 'ITERATIONS/ 目录不存在（尚无迭代）',
    });
    return results;
  }

  const entries = await readdir(iterDir);
  const iterations = entries.filter(e => e.startsWith('Iteration-'));

  results.push({
    ok: iterations.length > 0,
    category: '迭代',
    message: iterations.length > 0 ? `发现 ${iterations.length} 个迭代` : 'ITERATIONS/ 为空',
  });

  // 检查是否有孤儿 Task（迭代目录下无 030-tasks/）
  for (const iter of iterations) {
    const tasksDir = join(iterDir, iter, '030-tasks');
    const hasTasks = await pathExists(tasksDir);
    if (!hasTasks) {
      results.push({
        ok: false,
        category: '迭代',
        message: `${iter}: 无 030-tasks/ 目录（可能未执行 split）`,
        fix: `speccore split -I ${iter}`,
      });
    }
  }

  return results;
}

async function checkPatterns(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const patternsDir = join(projectRoot, '.speccore', 'PATTERNS');
  const readmePath = join(patternsDir, 'README.md');

  if (!(await pathExists(readmePath))) {
    results.push({
      ok: true,
      category: 'PATTERNS',
      message: 'PATTERNS/README.md 不存在（尚无模式沉淀）',
    });
    return results;
  }

  const content = await readFile(readmePath, 'utf-8');
  const hasConfidence = content.includes('置信度');

  results.push({
    ok: hasConfidence,
    category: 'PATTERNS',
    message: hasConfidence ? 'README.md 包含置信度规范（v6.91.0+）' : 'README.md 缺少置信度规范',
  });

  return results;
}

function printSummary(results: DiagnosisResult[]) {
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;

  logger.info('\n' + '═'.repeat(50));
  logger.info(`📊 诊断结果: ${okCount} 项通过 / ${failCount} 项待修复 / 共 ${results.length} 项`);
  logger.info('═'.repeat(50) + '\n');

  // 按类别分组
  const byCategory = new Map<string, DiagnosisResult[]>();
  for (const r of results) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }

  for (const [category, items] of byCategory) {
    logger.info(`📁 ${category}`);
    for (const item of items) {
      const icon = item.ok ? '✅' : '⚠️ ';
      logger.info(`   ${icon} ${item.message}`);
      if (!item.ok && item.fix) {
        logger.info(`      💡 修复: ${item.fix}`);
      }
    }
    logger.info('');
  }

  if (failCount === 0) {
    logger.info('🎉 项目健康度良好，所有检查通过！');
  } else {
    logger.info(`⚠️  发现 ${failCount} 个问题，建议按提示修复`);
  }
}

function formatTime(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// v6.95.0+: 检查并发锁状态
async function checkLocks(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const lock = await checkLock(projectRoot, 'iteration');
  if (lock) {
    const ageMin = Math.round((Date.now() - new Date(lock.acquiredAt).getTime()) / 60000);
    results.push({
      ok: ageMin < 30,
      category: '并发锁',
      message: `迭代被 ${lock.holder} 锁定 (${ageMin} 分钟)`,
      fix: ageMin >= 30 ? '锁已过期，运行 speccore doctor --fix 清理' : '等待锁持有者完成操作',
    });
  } else {
    results.push({
      ok: true,
      category: '并发锁',
      message: '无活跃锁',
    });
  }
  return results;
}

// v6.96.0+: 检查通知积压
async function checkNotificationBacklog(projectRoot: string): Promise<DiagnosisResult[]> {
  const results: DiagnosisResult[] = [];
  const unread = await getNotifications(projectRoot, { unreadOnly: true });
  if (unread.length > 10) {
    results.push({
      ok: false,
      category: '通知',
      message: `未读通知积压: ${unread.length} 条`,
      fix: '运行 speccore notify --all 标记已读，或逐条处理',
    });
  } else {
    results.push({
      ok: true,
      category: '通知',
      message: `未读通知: ${unread.length} 条`,
    });
  }
  return results;
}
