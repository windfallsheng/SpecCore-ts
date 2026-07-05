/**
 * impact - 智能变更影响分析命令
 * 分析需求/代码变更对上下游的影响范围，生成影响链报告
 */

import { logger, Spinner } from '../utils/logger';
import { readGlobalIndex } from '../core/global-layer';

export interface ImpactOptions {
  req?: string;
  task?: string;
  depth?: string;
  output?: string;
}

interface ImpactNode {
  id: string;
  name: string;
  type: 'requirement' | 'task' | 'project' | 'iteration';
  relation: string;
  level: number;
}

export async function impactCommand(options: ImpactOptions): Promise<void> {
  if (!options.req && !options.task) {
    logger.error('请提供需求 ID 或 Task 编号。用法: speccore impact --req=<REQ-XXX> 或 --task=<Task-XXX>');
    return;
  }

  const spinner = new Spinner('正在构建依赖图...');
  spinner.start();

  try {
    const depth = parseInt(options.depth || '3', 10);
    const index = await readGlobalIndex();

    // 1. 定位变更源
    let sourceReq = options.req
      ? index.reqs.find((r) => r.id === options.req)
      : undefined;

    if (options.task && !sourceReq) {
      // 通过 Task 反查需求
      sourceReq = index.reqs.find((r) => r.task === options.task);
    }

    if (!sourceReq) {
      const target = options.req || options.task;
      spinner.fail(`未找到 ${target}`);
      logger.info('请运行 speccore global-status 查看可用需求列表');
      return;
    }

    spinner.stop();

    // 2. 构建影响链
    const impacts = await buildImpactChain(sourceReq, index, depth);

    // 3. 输出报告
    if (options.output === 'graph') {
      outputMermaidGraph(sourceReq, impacts);
    } else {
      outputImpactReport(sourceReq, impacts);
    }
  } catch (error) {
    spinner.fail(`影响分析失败: ${error}`);
    throw error;
  }
}

/**
 * 构建影响链
 */
async function buildImpactChain(
  sourceReq: { id: string; name: string; project: string; iteration?: string },
  index: Awaited<ReturnType<typeof readGlobalIndex>>,
  depth: number
) {
  const projectImpacts: ImpactNode[] = [];      // 项目内影响
  const crossProjectImpacts: ImpactNode[] = [];  // 跨项目影响
  const iterationImpacts: ImpactNode[] = [];     // 期次影响
  const lateralImpacts: ImpactNode[] = [];       // 横向关联

  // 项目内影响（同一项目的其他需求）
  projectImpacts.push({
    id: sourceReq.id,
    name: sourceReq.name,
    type: 'requirement',
    relation: '直接关联（变更源）',
    level: 0,
  });

  const sameProjectReqs = index.reqs.filter(
    (r) => r.project === sourceReq.project && r.id !== sourceReq.id
  );
  for (const req of sameProjectReqs) {
    projectImpacts.push({
      id: req.id,
      name: req.name,
      type: 'requirement',
      relation: req.iteration ? '关联期次' : '同项目',
      level: 1,
    });
  }

  // 跨项目影响
  const otherProjectReqs = index.reqs.filter(
    (r) => r.project !== sourceReq.project
  );
  const affectedProjects = new Set<string>();
  for (const req of otherProjectReqs) {
    affectedProjects.add(req.project);
  }
  for (const proj of affectedProjects) {
    const projReqs = otherProjectReqs.filter((r) => r.project === proj);
    for (const req of projReqs.slice(0, 3)) {
      crossProjectImpacts.push({
        id: req.id,
        name: req.name,
        type: 'requirement',
        relation: `依赖 ${sourceReq.project}`,
        level: Math.min(2, depth),
      });
    }
  }

  // 期次影响
  const relatedIters = index.iterations.filter((iter) =>
    iter.reqs.some((r) =>
      index.reqs
        .filter((x) => x.project === sourceReq.project)
        .map((x) => x.id)
        .includes(r)
    )
  );
  for (const iter of relatedIters) {
    iterationImpacts.push({
      id: iter.name,
      name: iter.name,
      type: 'iteration',
      relation: iter.status === '🔄 进行中' ? '⚠️ 需回归验证' : '关联',
      level: 1,
    });
  }

  // 横向关联（同一期次的其他需求）
  if (sourceReq.iteration) {
    const iter = index.iterations.find((i) => i.name === sourceReq.iteration);
    if (iter) {
      const otherReqs = iter.reqs.filter((r) => r !== sourceReq.id);
      for (const reqId of otherReqs.slice(0, 5)) {
        const req = index.reqs.find((r) => r.id === reqId);
        if (req) {
          lateralImpacts.push({
            id: req.id,
            name: req.name,
            type: 'requirement',
            relation: '同期次关联',
            level: 1,
          });
        }
      }
    }
  }

  return { projectImpacts, crossProjectImpacts, iterationImpacts, lateralImpacts };
}

/**
 * 输出文字版影响分析报告
 */
function outputImpactReport(
  sourceReq: { id: string; name: string; project: string },
  impacts: {
    projectImpacts: ImpactNode[];
    crossProjectImpacts: ImpactNode[];
    iterationImpacts: ImpactNode[];
    lateralImpacts: ImpactNode[];
  }
) {
  logger.info('');
  logger.info('🔗 变更影响分析报告');
  logger.info('');

  // 变更源
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('📌 变更源');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`   类型: 需求变更`);
  logger.info(`   ID: ${sourceReq.id}`);
  logger.info(`   名称: ${sourceReq.name}`);
  logger.info(`   项目: ${sourceReq.project}`);

  // 项目内影响
  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('📊 影响链');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  logger.info(`   📂 项目内影响 (${impacts.projectImpacts.length} 项)`);
  for (const n of impacts.projectImpacts) {
    const prefix = n.level === 0 ? '     ★' : '     ├──';
    logger.info(`${prefix} ${n.id} ${n.name} (${n.relation})`);
  }

  logger.info(`   📂 跨项目影响 (${impacts.crossProjectImpacts.length} 项)`);
  const crossProjects = new Map<string, ImpactNode[]>();
  for (const n of impacts.crossProjectImpacts) {
    const proj = n.relation.replace('依赖 ', '');
    if (!crossProjects.has(proj)) crossProjects.set(proj, []);
    crossProjects.get(proj)!.push(n);
  }
  for (const [proj, nodes] of crossProjects) {
    logger.info(`   ├── ${proj}`);
    for (const n of nodes) {
      logger.info(`   │   └── ${n.id} ${n.name}`);
    }
  }

  if (impacts.iterationImpacts.length > 0) {
    logger.info(`   📂 期次影响 (${impacts.iterationImpacts.length} 项)`);
    for (const n of impacts.iterationImpacts) {
      logger.info(`     ├── ${n.id} ${n.relation}`);
    }
  }

  if (impacts.lateralImpacts.length > 0) {
    logger.info(`   📂 横向关联 (${impacts.lateralImpacts.length} 项)`);
    for (const n of impacts.lateralImpacts) {
      logger.info(`     ├── ${n.id} ${n.name} (${n.relation})`);
    }
  }

  // 风险等级
  const totalAffected =
    impacts.crossProjectImpacts.length +
    impacts.lateralImpacts.length +
    impacts.iterationImpacts.filter((i) => i.relation.includes('⚠️')).length;

  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('🚨 风险等级');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let riskLevel = '🟢 低风险';
  if (totalAffected >= 5) riskLevel = '🔴 高风险';
  else if (totalAffected >= 2) riskLevel = '🟡 中风险';

  const crossCount = impacts.crossProjectImpacts.length;
  const iterCount = impacts.iterationImpacts.length;
  logger.info(`   ${riskLevel}: 影响 ${crossCount} 个外部项目，涉及 ${iterCount} 个期次`);

  // 建议
  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('💡 建议');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  let idx = 1;
  if (crossCount > 0) {
    logger.info(`   ${idx++}. ${riskLevel.includes('🔴') ? '🔴' : '🟡'} 优先通知 ${[...new Set(impacts.crossProjectImpacts.map((i) => i.relation.replace('依赖 ', '')))].join(' 和 ')} 团队`);
  }
  if (impacts.iterationImpacts.filter((i) => i.relation.includes('⚠️')).length > 0) {
    logger.info(`   ${idx++}. 🔴 对进行中的期次进行回归测试`);
  }
  if (impacts.lateralImpacts.length > 0) {
    logger.info(`   ${idx++}. 🟡 建议联合评审 ${sourceReq.id} 和相关需求`);
  }
  logger.info(`   ${idx++}. 📋 运行 speccore sync-global 同步更新全量层`);
}

/**
 * 输出 Mermaid 依赖图
 */
function outputMermaidGraph(
  sourceReq: { id: string; name: string; project: string },
  impacts: {
    projectImpacts: ImpactNode[];
    crossProjectImpacts: ImpactNode[];
    iterationImpacts: ImpactNode[];
    lateralImpacts: ImpactNode[];
  }
) {
  logger.info('');
  logger.info('```mermaid');
  logger.info('graph TD');

  const srcId = sourceReq.id.replace(/-/g, '');
  logger.info(`    ${srcId}[${sourceReq.id} ${sourceReq.name}]`);

  for (const n of impacts.projectImpacts.slice(1, 5)) {
    const nid = n.id.replace(/-/g, '');
    logger.info(`    ${srcId} --> ${nid}[${n.id} ${n.name}]`);
  }

  for (const n of impacts.crossProjectImpacts.slice(0, 5)) {
    const nid = n.id.replace(/-/g, '');
    const projNode = n.relation.replace('依赖 ', '').replace(/-/g, '');
    logger.info(`    ${srcId} --> ${projNode}[${n.relation.replace('依赖 ', '')}]`);
    logger.info(`    ${projNode} --> ${nid}[${n.id} ${n.name}]`);
  }

  for (const n of impacts.iterationImpacts) {
    const nid = n.id.replace(/-/g, '').replace(/[^a-zA-Z0-9]/g, '');
    logger.info(`    ${srcId} --> ITER_${nid}[${n.id}]`);
  }

  logger.info('```');
}
