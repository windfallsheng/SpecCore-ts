/**
 * analyze 模式：--from-code 源码反推需求（两跳 IR→UR）+ 全局技术分析
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 B，逻辑不搬家、行为不变）
 *
 * v8.3.394+: 反推链接力协议补全（此前链路缺交棒，文档停骨架态）：
 *   - 主路径骨架态 → emitAiPrompt 两跳接力 + exit 10（宿主 AI 填 IR/UR，此前只有一句 logger.info）；
 *   - QA 环三阶段（verify/review/revise）→ 各自阶段接力 + exit 10（此前生成剧本后无驱动）；
 *   - 骨架完成度自检（countSkeletonPlaceholders 占位符统计，跑完如实报告骨架态/成品态）；
 *   - --verify 前置填充检查（骨架态跑 verify 只会得到空剧本，先警告）；
 *   - 旧域产物 --migrate 自动迁移（move 到 _legacy-*，可逆移位不删除）；
 *   - 需求↔代码联动推迟到成品态（骨架态无真实需求可联）。
 */
import { join } from 'path';
import { pathExists, readdir, move } from 'fs-extra';
import { logger } from '../../utils/logger';
import { emitAiPrompt, type AnalyzeOptions } from './shared';
import { countSkeletonPlaceholders } from '../../core/reverse-requirement';

/** 端目录骨架完成度快照（自检报告用） */
interface EndpointStatus {
  dir: string;
  label: string;
  requirement: number;
  irFilled: number;
  irTotal: number;
}

async function collectStatuses(dirs: string[]): Promise<EndpointStatus[]> {
  const out: EndpointStatus[] = [];
  for (const d of dirs) {
    const st = await countSkeletonPlaceholders(d);
    out.push({ dir: d, label: d.split('/').pop() || d, ...st });
  }
  return out;
}

/** v8.3.394+: 旧域迁移——move 到 requirements/_legacy-*（可逆，仅移位不删除） */
async function migrateLegacyDomains(baseDir: string): Promise<string[]> {
  const migrated: string[] = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const moveToLegacy = async (src: string, tag: string): Promise<void> => {
    if (!(await pathExists(src))) return;
    const dest = join(baseDir, `_legacy-${tag}-${ts}`);
    await move(src, dest);
    migrated.push(`${src.replace(process.cwd() + '/', '')} → ${dest.replace(process.cwd() + '/', '')}`);
  };
  // 1) v8.3.368-378 旧域：GLOBAL/_reverse/（单目录域）
  await moveToLegacy(join('.speccore', 'GLOBAL', '_reverse'), 'reverse');
  // 2) v8.3.368 前旧域：requirements/ 根级直铺（只动反推产物件，不碰 4a 的 REQUIREMENT.md 总纲）
  for (const item of ['_ir', 'REVERSE_PROMPT.md', '_qa']) {
    await moveToLegacy(join(baseDir, item), item);
  }
  return migrated;
}

/** 两跳填充接力 Prompt（主路径骨架态交棒，缺口 1） */
function buildTwoHopRelayPrompt(statuses: EndpointStatus[], srcArgs: string): string {
  const lines: string[] = [];
  lines.push('# 源码反推需求 · 两跳语义填充接力');
  lines.push('');
  lines.push('CLI 已完成确定性层：技术文档骨架与需求骨架（IR + UR）已生成。');
  lines.push('现在由你（宿主 AI）完成语义抽象——两跳填充落盘后，需求文档才算完成。');
  lines.push('');
  lines.push('## 骨架完成度现状');
  lines.push('');
  for (const s of statuses) {
    lines.push(`- \`${s.label}\`: UR 剩 ${s.requirement} 个占位符，IR 已填 ${s.irFilled}/${s.irTotal}`);
  }
  lines.push('');
  lines.push('## 你的任务（逐端执行）');
  lines.push('');
  lines.push('1. 读各端目录内的 `REVERSE_PROMPT.md`（两跳执行指引，硬性约束以它为准）；');
  lines.push('2. 第一跳：逐份填充 `_ir/*.md` 的「业务语义」六节（模块职责/关键业务规则/权限与边界/数据约束/输入输出/异常与边界），');
  lines.push('   业务切片不足以确认的规则，用 Read 工具深读锚点文件的函数体原文——业务语义藏在函数体里；');
  lines.push('3. 第二跳：按 IR 合成 `REQUIREMENT.md` 各章（概述/用户故事与场景/功能需求+EARS/非功能/成功指标），');
  lines.push('   每条验收标准必须带「溯源锚点」（引用真实 IR 模块 id）与置信度；');
  lines.push('4. 用 Write 工具直接落盘（`_ir/*.md` 与 `REQUIREMENT.md`），不得遗留任何 `_AI 填写` 占位符；');
  lines.push('5. 全部端填充完成后运行: `speccore global from-source --verify`（--src 保持原样）进入 QA 环。');
  lines.push('');
  lines.push('## 质量红线');
  lines.push('');
  lines.push('- 禁止编造代码中不存在的逻辑，不确定处标「待确认」；');
  lines.push('- 函数名/类名/接口名不得出现在需求文本里（反翻译腔：把「调用 XService.createOrder」写成「用户提交订单」）；');
  lines.push('- 置信度三级门控：Verified=直接代码证据；Inferred=间接推断（注明依据）；Unverified=只能进「待确认项」。');
  lines.push('');
  lines.push('## 续跑命令（保留 --src 原样）');
  lines.push('');
  lines.push('```');
  lines.push(`speccore global from-source ${srcArgs}`);
  lines.push(`speccore global from-source ${srcArgs} --verify`);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

/** QA 阶段接力 Prompt（verify/review/revise 各阶段交棒，缺口 2） */
function buildQaRelayPrompt(stage: 'verify' | 'review' | 'revise', units: string[]): string {
  const lines: string[] = [];
  if (stage === 'verify') {
    lines.push('# 反推需求 QA 环 · 验证接力（code-verifier 角色）');
    lines.push('');
    lines.push('CLI 已生成验证剧本与 verify.json 模板。现在由你扮演 code-verifier 完成事实验证。');
    lines.push('');
    lines.push('## 你的任务');
    lines.push('');
    lines.push('1. 读各端 `_qa/VERIFY_PLAYBOOK.md`（逐条 AC 对照代码证据的验证剧本）；');
    lines.push('2. 逐条验收标准对照源码验证，填写 `_qa/verify.json`（status: verified/needs_review/inconsistent/unverified）；');
    lines.push('3. 全部条目验证完成后置 `status: done`——须过 Quality Gate：计数平衡、无 blocked；');
    lines.push('4. 完成后运行: `speccore global from-source --review` 进入语义审查。');
  } else if (stage === 'review') {
    lines.push('# 反推需求 QA 环 · 语义审查接力（document-reviewer 角色）');
    lines.push('');
    lines.push('CLI 已生成审查剧本与 review.json 模板。现在由你扮演 document-reviewer 完成八维语义审查。');
    lines.push('');
    lines.push('## 你的任务');
    lines.push('');
    lines.push('1. 读各端 `_qa/REVIEW_PLAYBOOK.md`（八维审查：完整性/正确性/可测试性/翻译腔/粒度/可追溯性/交互完整性/无障碍）；');
    lines.push('2. 以 `_qa/verify.json` 为证据，逐条产出 finding（id/severity/category/finding/evidence/suggestion）；');
    lines.push('3. 每条 finding 做 Review Resolution 裁决：disposition = apply（必须修订）/ decline（拒绝）；');
    lines.push('4. 填写 `_qa/review.json` 并置 `status: resolved`（disposition 不得残留 pending，否则 --revise 拒绝推进）；');
    lines.push('5. 完成后运行: `speccore global from-source --revise` 进入裁决门禁。');
  } else {
    lines.push('# 反推需求 QA 环 · 修订接力（prd-creator update 模式）');
    lines.push('');
    lines.push('CLI 已通过 Review Resolution Gate 生成修订剧本。现在由你按裁决结果执行有条件修订。');
    lines.push('');
    lines.push('## 你的任务');
    lines.push('');
    lines.push('1. 读各端 `_qa/REVISION_PLAYBOOK.md`（apply findings 全文作修订范围）；');
    lines.push('2. Operation Mode: update——只修订 findings 指向的条目，保留相邻内容，勿扩改；');
    lines.push('3. 修订对象: 各端 `REQUIREMENT.md`，修订后同步更新溯源锚点（如涉及）；');
    lines.push('4. 修订完成后必须 re-validation，循环直到无 apply findings：');
    lines.push('   `speccore global from-source --verify`（code-verifier 重跑）→ `--review`（带 prior_feedback 重跑）→ `--revise`（无 apply findings 即闭环完成）。');
  }
  lines.push('');
  lines.push('## 涉及端目录');
  lines.push('');
  for (const u of units) lines.push(`- ${u.replace(process.cwd() + '/', '')}`);
  lines.push('');
  return lines.join('\n');
}

export async function analyzeFromCode(options: AnalyzeOptions): Promise<void> {
  // v8.3.367+: QA 环（对齐 recipe-reverse-engineer 五阶段）——
  // --verify 验证环（锚点门禁+完整性基线+code-verifier 剧本）/ --review 语义审查 / --revise 有条件修订
  if (options.verify || options.review || options.revise || options.migrate) {
    // v8.3.394.1: QA 环三阶段须逐个运行（--verify → --review → --revise），
    // 组合传入会跳过前一阶段的宿主 AI 接力（exit 10 交棒被后一分支覆盖），
    // 下一阶段拿不到上阶段产物（如 review 剧本要求以 verify.json 为证据）。
    const qaFlags = [options.verify, options.review, options.revise].filter(Boolean).length;
    if (qaFlags > 1) {
      logger.error('QA 环三阶段须逐个运行（--verify → --review → --revise），请勿组合传入多个 flag。');
      logger.error('   组合运行会跳过前一阶段的宿主 AI 接力，下一阶段拿不到上阶段产物（如 review 需要 verify.json 证据）。');
      return;
    }
    const { runReverseVerify, runReverseReview, runReverseRevision } = await import('../../core/reverse-qa');
    // v8.3.379: 按端组织——反推产物落 GLOBAL/requirements/{端}/（REQUIREMENT.md + _ir/ + _qa/），
    // QA 环逐端执行；显式 --out-dir 视为单端目录直接使用。
    const baseDir = options.outDir || join('.speccore', 'GLOBAL', 'requirements');

    // v8.3.394+: --migrate 旧域迁移（可逆移位，不删除）
    if (options.migrate) {
      const migrated = await migrateLegacyDomains(baseDir);
      if (migrated.length > 0) {
        logger.info('');
        logger.info('🗂️ 旧域产物已迁移（可逆移位，未删除）:');
        for (const m of migrated) logger.info(`   - ${m}`);
        logger.info('   迁移后请重新运行反推生成新域结构: speccore global from-source --src <dirs>');
      } else {
        logger.info('');
        logger.info('ℹ️ 未检测到旧域产物（无 GLOBAL/_reverse/ 或 requirements/ 根级直铺 _ir/REVERSE_PROMPT.md），无需迁移。');
      }
      return;
    }

    const units: string[] = [];
    if (options.outDir) {
      units.push(baseDir);
    } else {
      // 1) 新域：requirements/ 下自包含的端级单元（REQUIREMENT.md + _ir 或 REVERSE_PROMPT.md）
      const children = await readdir(baseDir, { withFileTypes: true }).catch(() => [] as never[]);
      for (const c of children as Array<{ name: string; isDirectory(): boolean }>) {
        if (!c.isDirectory()) continue;
        const d = join(baseDir, c.name);
        const hasReq = await pathExists(join(d, 'REQUIREMENT.md'));
        const hasIr = await pathExists(join(d, '_ir'));
        const hasPrompt = await pathExists(join(d, 'REVERSE_PROMPT.md'));
        if (hasReq && (hasIr || hasPrompt)) units.push(d);
      }
      // 2) 旧域兜底（v8.3.368-378）：GLOBAL/_reverse/ 单目录域，存量项目继续可用
      if (units.length === 0) {
        const reverseDir = join('.speccore', 'GLOBAL', '_reverse');
        if (await pathExists(join(reverseDir, '_ir'))) {
          units.push(reverseDir);
          logger.warn('⚠️  检测到旧域反推产物（GLOBAL/_reverse/），本次继续使用旧域；');
          logger.warn('   建议迁移到 GLOBAL/requirements/{端}/：加 --migrate 自动迁移（可逆移位）。');
        }
      }
      // 3) 旧域兜底（v8.3.368 前）：requirements/ 根级直铺（_ir + REVERSE_PROMPT.md）
      if (units.length === 0) {
        const hasIr = await pathExists(join(baseDir, '_ir'));
        const hasPrompt = await pathExists(join(baseDir, 'REVERSE_PROMPT.md'));
        if (hasIr || hasPrompt) {
          units.push(baseDir);
          logger.warn('⚠️  检测到 v8.3.368 前旧域反推产物（GLOBAL/requirements/ 根级直铺），本次继续使用旧域；');
          logger.warn('   建议迁移到 GLOBAL/requirements/{端}/：加 --migrate 自动迁移（可逆移位）。');
        }
      }
    }
    if (units.length === 0) {
      logger.warn(`未找到反推产物（GLOBAL/requirements/{端}/ 下无 REQUIREMENT.md/_ir），请先运行 speccore global from-source --src <dirs> 完成反推。`);
      return;
    }

    // v8.3.394+: --verify 前置填充检查（缺口 4）——骨架态跑 verify 只会得到空剧本
    if (options.verify) {
      const skeletonUnits: string[] = [];
      for (const unit of units) {
        const st = await countSkeletonPlaceholders(unit);
        if (st.requirement > 0 || st.irPlaceholders > 0) {
          skeletonUnits.push(unit.split('/').pop()!);
        }
      }
      if (skeletonUnits.length > 0) {
        logger.error(`❌ 验证环拒绝：${skeletonUnits.join('、')} 仍在骨架态（UR/IR 未填占位符）——verify 只会得到空剧本，无法产出有效验证。`);
        logger.error('   请先完成两跳填充（重跑 speccore global from-source --src <dirs> 触发接力），再运行 --verify。');
        process.exitCode = 1;
        return;
      }
    }

    // v8.3.394+: 各阶段独立执行与结果收集（revise 需裁决结果决定是否交棒）
    const reviseResults: Array<{ completed: boolean }> = [];
    for (const unit of units) {
      const unitLabel = units.length > 1 ? ` [${unit.split('/').pop()}]` : '';
      if (options.verify) {
        try {
          logger.info('');
          logger.info(`🔍 验证环（--verify）${unitLabel}：锚点门禁 + 完整性基线 + code-verifier 剧本`);
          await runReverseVerify(unit);
        } catch (e: any) {
          logger.error(`验证环失败${unitLabel}: ${e?.message || e}`);
        }
      }
      if (options.review) {
        try {
          logger.info('');
          logger.info(`📖 语义审查（--review）${unitLabel}：document-reviewer 审查剧本`);
          await runReverseReview(unit);
        } catch (e: any) {
          logger.error(`语义审查失败${unitLabel}: ${e?.message || e}`);
        }
      }
      if (options.revise) {
        try {
          const res = await runReverseRevision(unit);
          reviseResults.push({ completed: res.completed });
        } catch (e: any) {
          logger.error(`修订裁决失败${unitLabel}: ${e?.message || e}`);
          reviseResults.push({ completed: false });
        }
      }
    }

    // v8.3.394+: QA 阶段接力（缺口 2）——各阶段收尾交棒宿主 AI 执行剧本
    if (options.revise) {
      if (reviseResults.length > 0 && reviseResults.every(r => r.completed)) {
        logger.info('🏁 全部端修订裁决闭环完成（无 apply findings），反推需求全链路收尾，无需接力。');
        return;
      }
      await emitAiPrompt('GLOBAL', buildQaRelayPrompt('revise', units), { mode: 'reverse-qa-revise' });
      process.exitCode = 10;
      return;
    }
    if (options.review) {
      await emitAiPrompt('GLOBAL', buildQaRelayPrompt('review', units), { mode: 'reverse-qa-review' });
      process.exitCode = 10;
      return;
    }
    if (options.verify) {
      await emitAiPrompt('GLOBAL', buildQaRelayPrompt('verify', units), { mode: 'reverse-qa-verify' });
      process.exitCode = 10;
      return;
    }
    return;
  }
  const { generateGlobalArtifacts, applySemanticContent, buildGlobalDocsPrompt } = await import('../../core/global-artifacts');
  const { reverseRequirementsFromCode } = await import('../../core/reverse-requirement');
  const sources = options.source
    ? options.source.split(',').map(s => s.trim()).filter(Boolean)
    : options.sourceScope
      ? options.sourceScope.split(',').map(s => s.trim()).filter(Boolean)
      : [];

  // v8.3.369: AI 接力闭环 —— 确定性骨架 + _DOCS_PLAYBOOK 剧本 → 宿主 AI 语义回填。
  // --prompt: 生成骨架+剧本后输出接力 Prompt；--apply: 接收语义内容按「标题定位」合并进骨架文档。
  if (options.prompt || options.apply) {
    if (options.prompt) {
      await generateGlobalArtifacts(sources, options.depth || 'normal');
      logger.info('');
      logger.info('📝 技术文档骨架已生成（确定性事实层），接力剧本: .speccore/GLOBAL/_DOCS_PLAYBOOK.md');
      logger.info('   下一步：宿主 AI 读取剧本完成语义抽象，用 --apply 回填占位');
      await emitAiPrompt('GLOBAL', buildGlobalDocsPrompt(), { mode: 'global-docs-relay' });
      process.exitCode = 10;
      return;
    }
    try {
      const result = await applySemanticContent(options.apply!);
      logger.info('');
      logger.info(`✅ 语义回填完成: ${result.filled}/${result.total} 节`);
      if (result.missing.length > 0) {
        logger.warn(`⚠️ 未命中占位（${result.missing.length} 项）:`);
        for (const m of result.missing.slice(0, 10)) logger.warn(`   - ${m}`);
      }
    } catch (e: any) {
      logger.error(`语义回填失败: ${e?.message || e}`);
    }
    return;
  }
  try {
    // 1. 全局技术分析文档（TECH_STACK/CODE_INDEX/ARCHITECTURE/API_INVENTORY/DATA_MODEL/GLOSSARY/按端 OVERVIEW+TECH）
    await generateGlobalArtifacts(sources, options.depth || 'normal');
    // 2. 从源码反推需求（两跳 IR→UR）
    const result = await reverseRequirementsFromCode({
      sources,
      depth: options.depth,
      platforms: options.platform ? options.platform.split(',').map(p => p.trim()).filter(Boolean) : undefined,
      outputDir: options.outDir,
    });
    logger.info('');
    logger.info(`🎯 源码反推需求完成（status: candidate，澄清后才成 Spec）`);
    logger.info(`   🗂️ 按端组织: .speccore/GLOBAL/requirements/{端}/（共 ${result.outputDirs.length} 端）`);
    for (const d of result.outputDirs) {
      logger.info(`      - ${d.replace(process.cwd() + '/', '')}/（REQUIREMENT.md + _ir/ + REVERSE_PROMPT.md）`);
    }
    logger.info(`   🧩 IR 总数: ${result.irCount} 个模块`);
    logger.info('');

    // v8.3.394+: 骨架完成度自检 + 两跳接力协议（缺口 1+3）
    const statuses = await collectStatuses(result.outputDirs);
    const totalPlaceholders = statuses.reduce((n, s) => n + s.requirement + (s.irTotal - s.irFilled), 0);
    if (totalPlaceholders > 0) {
      logger.info('   🦴 骨架完成度（两跳语义填充尚未完成）:');
      for (const s of statuses) {
        logger.info(`      - ${s.label}: UR 剩 ${s.requirement} 个占位符，IR 已填 ${s.irFilled}/${s.irTotal}`);
      }
      logger.info('');
      logger.info('   ⚠️ 需求文档仍在骨架态——下方输出两跳填充接力 Prompt，宿主 AI 落盘后才算完成。');
      // v8.3.394.1: 完整重建续跑参数（此前只带 --src，丢失 --depth/--platform/--out-dir 致续跑行为漂移）
      const parts: string[] = [];
      const src = options.source || options.sourceScope;
      if (src) parts.push(`--src "${src}"`);
      if (options.depth) parts.push(`--depth ${options.depth}`);
      if (options.platform) parts.push(`--platform ${options.platform}`);
      if (options.outDir) parts.push(`--out-dir ${options.outDir}`);
      const srcArgs = parts.join(' ');
      await emitAiPrompt('GLOBAL', buildTwoHopRelayPrompt(statuses, srcArgs), { mode: 'reverse-two-hop' });
      process.exitCode = 10;
      return;
    }

    logger.info('   ✅ 两跳填充已完成（无占位符残留），进入 QA 环: speccore global from-source --verify');
    logger.info('');

    // v8.3.356+: 需求↔代码联动（requirement-linker 从零接入变为链上消费）——
    // v8.3.394+: 只在成品态建立联动（缺口 6——骨架态联的是占位符而非真实需求）
    try {
      const { linkRequirementsToCode } = await import('../../core/code-graph');
      const link = await linkRequirementsToCode(process.cwd(), undefined);
      logger.info(`   🔗 需求↔代码联动: ${link.totalRequirements} 需求 ↔ ${link.totalLinkedNodes} 节点（覆盖率 ${(link.coverageRatio * 100).toFixed(0)}%）`);
    } catch (linkError: any) {
      logger.warn(`   ⚠️ 需求↔代码联动跳过: ${linkError?.message || linkError}`);
    }
  } catch (e: any) {
    logger.error(`源码反推需求失败: ${e?.message || e}`);
  }
}
