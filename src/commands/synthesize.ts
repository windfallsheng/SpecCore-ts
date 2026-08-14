/**
 * synthesize — 需求文档智能合成命令
 *
 * 三种模式：
 *
 * 模式 A: 简单合成（向后兼容）
 *   将 converted/*.md 合并为 REQUIREMENT.md
 *   CLI:  speccore synthesize -I <迭代名>
 *
 * 模式 B: 全自动三阶段（--full）
 *   Phase 1: 逐端分析 → .speccore/GLOBAL/platforms/{端名}/ 各端独立 specs
 *   Phase 2: 跨端综合 → .speccore/GLOBAL/synthesis/ CROSS_PLATFORM.md + ARCHITECTURE.md + TECH_FULL.md
 *   Phase 3: 功能单元合成 → Iteration-NNN/010-requirements/REQUIREMENT.md
 *   旧版自动归档到 .speccore/GLOBAL/snapshots/{时间戳}/
 *   CLI:  speccore synthesize --full -I <迭代名>
 *
 * 模式 C: 单阶段执行（--phase N）
 *   CLI:  speccore synthesize --phase 1 -I <迭代名>
 *
 * 使用方式：
 *   CLI:  speccore synthesize -I <迭代名>
 *   AI:   /spec-ask "合成 Q2 迭代的需求文档"
 */

import { writeFile, pathExists, ensureDir, readFile, readdir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { backupWithTimestamp, isTimestampBackup } from '../utils/task-utils';

export interface SynthesizeOptions {
  iteration?: string;
  withCode?: boolean;
  prompt?: boolean;
  apply?: string;
  full?: boolean;
  phase?: string;
  applyPhase?: string;  // --apply-phase N <content>
}

// ── CONSTITUTION 工程列表解析 ──
interface PlatformEntry {
  project: string;
  srcPath: string;
  gitRepo: string;
  branch: string;
  platforms: string[];  // 对应需求端
}

async function parseConstitution(): Promise<PlatformEntry[]> {
  const constitutionPath = join('.speccore', 'CONSTITUTION.md');
  if (!await pathExists(constitutionPath)) return [];
  const content = await readFile(constitutionPath, 'utf-8');
  const entries: PlatformEntry[] = [];
  // 解析表格行: | project | srcPath | gitRepo | branch | platforms |
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('---') || line.includes('工程') && line.includes('源码路径')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 5) {
      entries.push({
        project: cells[0],
        srcPath: cells[1],
        gitRepo: cells[2],
        branch: cells[3],
        platforms: cells[4].split(',').map(p => p.trim()).filter(Boolean),
      });
    }
  }
  return entries;
}

export async function synthesizeCommand(options: SynthesizeOptions): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) {
    logger.error('请指定迭代: -I <迭代名>');
    return;
  }

  const iterDir = await getIterationDir(iter);
  const reqDir = join(iterDir, '010-requirements');
  const specDir = join(iterDir, '020-specs');
  const convDir = join(reqDir, 'converted');
  const outputPath = join(reqDir, 'REQUIREMENT.md');
  // 全局层目录：Phase 1/2 写入此处
  const globalDir = join('.speccore', 'GLOBAL');

  // ── Apply 模式（简单合成，向后兼容）──
  if (options.apply && !options.applyPhase) {
    await ensureDir(reqDir);
    const bk = await backupWithTimestamp(outputPath);
    if (bk) logger.info(`   📦 旧版已备份: ${bk.split('/').pop()}`);
    await writeFile(outputPath, options.apply);
    logger.success(`✅ 综合需求文档已生成: 010-requirements/REQUIREMENT.md`);
    return;
  }

  // ── Apply Phase 模式：接收某阶段的 AI 结果写入文件 ──
  if (options.applyPhase && options.apply) {
    await handleApplyPhase(iter, iterDir, globalDir, specDir, reqDir, parseInt(options.applyPhase), options.apply);
    return;
  }

  // ── --full 模式：全自动三阶段 ──
  if (options.full) {
    await runFullPipeline(iter, iterDir, globalDir, specDir, reqDir, convDir, options.withCode);
    return;
  }

  // ── --phase N 模式：单阶段执行 ──
  if (options.phase) {
    const phaseNum = parseInt(options.phase);
    if (phaseNum === 1) await runPhase1(iter, iterDir, globalDir, reqDir);
    else if (phaseNum === 2) await runPhase2(iter, iterDir, globalDir, specDir);
    else if (phaseNum === 3) await runPhase3(iter, iterDir, globalDir, specDir, reqDir, convDir, options.withCode);
    else logger.error(`无效阶段: ${options.phase}，可选 1/2/3`);
    return;
  }

  // ── 默认模式：简单合成（向后兼容）──
  await runSimpleSynthesize(iter, iterDir, reqDir, convDir, outputPath, options.withCode);
}

// ================================================================
// Apply Phase 处理
// ================================================================
async function handleApplyPhase(
  iter: string, iterDir: string, globalDir: string, specDir: string, reqDir: string,
  phase: number, content: string
): Promise<void> {
  if (phase === 1) {
    // Phase 1 apply: 写入全局层 platforms/（按端分目录）
    const platformsDir = join(globalDir, 'platforms');
    await ensureDir(platformsDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    await writeFile(join(platformsDir, `ANALYSIS-${timestamp}.md`), content);
    logger.success(`✅ Phase 1 结果已写入: .speccore/GLOBAL/platforms/`);
    // 提示下一阶段
    logger.info(`\n   📌 下一步: speccore synthesize --phase 2 -I ${iter}`);
  } else if (phase === 2) {
    // Phase 2 apply: 解析分隔标记，写入 GLOBAL/synthesis/ 下的独立文件
    const synthesisDir = join(globalDir, 'synthesis');
    await ensureDir(synthesisDir);
    // 备份旧版到 GLOBAL/snapshots/
    const snapshotsDir = join(globalDir, 'snapshots');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    if (await pathExists(synthesisDir)) {
      const existingFiles = (await readdir(synthesisDir)).filter(f => f.endsWith('.md'));
      if (existingFiles.length > 0) {
        const snapshotDir = join(snapshotsDir, timestamp);
        await ensureDir(snapshotDir);
        for (const f of existingFiles) {
          const src = join(synthesisDir, f);
          const dst = join(snapshotDir, f);
          await writeFile(dst, await readFile(src));
        }
        logger.info(`   📦 旧版已归档: snapshots/${timestamp}/`);
      }
    }
    // 解析分隔标记写入独立文件
    const sections: Record<string, string> = {};
    const markers = ['===CROSS_PLATFORM===', '===ARCHITECTURE===', '===TECH_FULL==='];
    const fileNames: Record<string, string> = {
      '===CROSS_PLATFORM===': 'CROSS_PLATFORM.md',
      '===ARCHITECTURE===': 'ARCHITECTURE.md',
      '===TECH_FULL===': 'TECH_FULL.md',
    };
    let remaining = content;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const idx = remaining.indexOf(marker);
      if (idx >= 0) {
        const nextIdx = i + 1 < markers.length ? remaining.indexOf(markers[i + 1], idx + marker.length) : -1;
        const sectionContent = nextIdx >= 0
          ? remaining.substring(idx + marker.length, nextIdx).trim()
          : remaining.substring(idx + marker.length).trim();
        await writeFile(join(synthesisDir, fileNames[marker]), sectionContent + '\n');
      }
    }
    // 如果没有分隔标记，整体写入 CROSS_PLATFORM.md
    if (!markers.some(m => content.includes(m))) {
      await writeFile(join(synthesisDir, 'CROSS_PLATFORM.md'), content);
    }
    logger.success(`✅ Phase 2 结果已写入: .speccore/GLOBAL/synthesis/`);
    logger.info(`   📄 CROSS_PLATFORM.md — 跨端关系图`);
    logger.info(`   📄 ARCHITECTURE.md  — 全量架构`);
    logger.info(`   📄 TECH_FULL.md    — 全量技术方案`);

    // 自动生成 INDEX.md 轻量索引
    await generateGlobalIndex(globalDir);

    logger.info(`\n   📌 下一步: speccore synthesize --phase 3 -I ${iter}`);
  } else if (phase === 3) {
    await ensureDir(reqDir);
    const bk = await backupWithTimestamp(join(reqDir, 'REQUIREMENT.md'));
    if (bk) logger.info(`   📦 旧版已备份: ${bk.split('/').pop()}`);
    await writeFile(join(reqDir, 'REQUIREMENT.md'), content);
    logger.success(`✅ Phase 3 结果已写入: 010-requirements/REQUIREMENT.md`);
    logger.info(`\n   ✅ 全量分析合成完成！`);
  }
}

// ================================================================
// --full 全自动三阶段流水线
// ================================================================
async function runFullPipeline(
  iter: string, iterDir: string, globalDir: string, specDir: string,
  reqDir: string, convDir: string, withCode?: boolean
): Promise<void> {
  const entries = await parseConstitution();
  if (entries.length === 0) {
    logger.warn('CONSTITUTION.md 未配置多工程，回退到简单合成模式');
    await runSimpleSynthesize(iter, iterDir, reqDir, convDir, join(reqDir, 'REQUIREMENT.md'), withCode);
    return;
  }

  logger.info(`\n🚀 全量分析合成 — 迭代「${iter}」`);
  logger.info(`   📋 检测到 ${entries.length} 个工程/端配置`);
  for (const e of entries) {
    logger.info(`      🔹 ${e.project} → 端: ${e.platforms.join(', ')}`);
  }

  // Phase 1: 逐端分析
  logger.info(`\n━━━ Phase 1/3: 逐端分析 ━━━`);
  await runPhase1(iter, iterDir, globalDir, reqDir);

  // Phase 2: 跨端综合
  logger.info(`\n━━━ Phase 2/3: 跨端综合 ━━━`);
  await runPhase2(iter, iterDir, globalDir, specDir);

  // Phase 3: 功能单元合成
  logger.info(`\n━━━ Phase 3/3: 功能单元需求合成 ━━━`);
  await runPhase3(iter, iterDir, globalDir, specDir, reqDir, convDir, withCode);

  logger.info(`\n✅ 全量分析合成完成！`);
  logger.info(`   📄 .speccore/GLOBAL/platforms/     ← 各端分析结果`);
  logger.info(`   📄 .speccore/GLOBAL/synthesis/     ← 跨端综合文档`);
  logger.info(`   📄 .speccore/GLOBAL/snapshots/     ← 历史快照`);
  logger.info(`   📄 010-requirements/REQUIREMENT.md ← 按功能单元组织的完整需求`);
}

// ================================================================
// Phase 1: 逐端分析
// ================================================================
async function runPhase1(
  iter: string, iterDir: string, globalDir: string, reqDir: string
): Promise<void> {
  const entries = await parseConstitution();
  if (entries.length === 0) {
    logger.warn('CONSTITUTION.md 未配置工程列表，无法执行逐端分析');
    return;
  }

  const platformsDir = join(globalDir, 'platforms');
  await ensureDir(platformsDir);

  // 读取各端需求文档
  const platformDocs: { platform: string; name: string; content: string }[] = [];
  for (const entry of entries) {
    for (const platform of entry.platforms) {
      // 尝试读取 010-requirements/{platform}/ 下的文档
      const platformReqDir = join(reqDir, platform);
      if (await pathExists(platformReqDir)) {
        const files = await readdir(platformReqDir);
        for (const f of files.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
          const content = await readFile(join(platformReqDir, f), 'utf-8');
          platformDocs.push({ platform, name: `${platform}/${f}`, content });
        }
      }
      // 也读取 converted/ 下带端标记的文件
      const convDir = join(reqDir, 'converted');
      if (await pathExists(convDir)) {
        const files = await readdir(convDir);
        for (const f of files.filter(f => f.endsWith('.md') && f.includes(platform) && !isTimestampBackup(f))) {
          const content = await readFile(join(convDir, f), 'utf-8');
          platformDocs.push({ platform, name: `converted/${f}`, content });
        }
      }
    }
  }

  // 也读取 GLOBAL/platforms/ 下用户自建的文档作为补充
  const globalPlatformsDir = join(globalDir, 'platforms');
  if (await pathExists(globalPlatformsDir)) {
    const gpEntries = await readdir(globalPlatformsDir, { withFileTypes: true });
    for (const entry of gpEntries) {
      if (entry.isDirectory()) {
        const subFiles = await readdir(join(globalPlatformsDir, entry.name));
        for (const f of subFiles.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
          const content = await readFile(join(globalPlatformsDir, entry.name, f), 'utf-8');
          platformDocs.push({ platform: entry.name, name: `GLOBAL/platforms/${entry.name}/${f}`, content });
        }
      } else if (entry.name.endsWith('.md') && !isTimestampBackup(entry.name)) {
        const content = await readFile(join(globalPlatformsDir, entry.name), 'utf-8');
        platformDocs.push({ platform: 'global', name: `GLOBAL/platforms/${entry.name}`, content });
      }
    }
  }

  if (platformDocs.length === 0) {
    logger.warn('未找到各端需求文档，跳过 Phase 1');
    return;
  }

  // 构建 Phase 1 Prompt
  const prompt = buildPhase1Prompt(iter, entries, platformDocs);
  process.stdout.write(`[SPECCORE_PHASE1]\n${prompt}`);
  process.exitCode = 10;
}

function buildPhase1Prompt(
  iter: string,
  entries: PlatformEntry[],
  platformDocs: { platform: string; name: string; content: string }[]
): string {
  let p = `# Phase 1: 逐端需求分析\n\n`;
  p += `## 目标\n`;
  p += `对迭代「${iter}」的每个端独立分析，生成各端的需求规格文档。\n\n`;

  p += `## 工程配置\n\n`;
  p += `| 工程 | 源码路径 | 对应需求端 |\n`;
  p += `|:--|:--|:--|\n`;
  for (const e of entries) {
    p += `| ${e.project} | ${e.srcPath} | ${e.platforms.join(', ')} |\n`;
  }
  p += `\n`;

  p += `## 各端需求文档\n\n`;
  // 按端分组
  const byPlatform: Record<string, typeof platformDocs> = {};
  for (const doc of platformDocs) {
    if (!byPlatform[doc.platform]) byPlatform[doc.platform] = [];
    byPlatform[doc.platform].push(doc);
  }
  for (const [platform, docs] of Object.entries(byPlatform)) {
    p += `### ${platform} 端\n\n`;
    for (const doc of docs) {
      p += `#### ${doc.name}\n\n`;
      p += doc.content.slice(0, 5000); // 限制单文档长度
      p += `\n\n---\n\n`;
    }
  }

  p += `## 分析要求（业内专业级）\n\n`;
  p += `对每个端独立分析，必须覆盖以下维度。\n`;
  p += `**先识别端类型**，再应用对应的专业维度。\n\n`;
  p += `### 端类型识别规则\n`;
  p += `| 端名关键词 | 类型 | 识别依据 |\n`;
  p += `|:--|:--|:--|\n`;
  p += `| backend/app/api/server | 后端服务 | Java/Go/Node/Python, Controller, DAO |\n`;
  p += `| admin/web/管理台/后台 | Web 管理端 | Vue/React + Element/AntDesign, 表格/表单 |\n`;
  p += `| h5/mobile/移动 | 移动 H5 | 响应式/viewport, 触摸事件, 移动端 UI 库 |\n`;
  p += `| miniapp/小程序/wx | 小程序 | wxml/wxss, uni-app, Taro, 微信/支付宝 API |\n`;
  p += `| app/native/android/ios | 原生/混合 App | Swift/Kotlin/Dart/React Native |\n\n`;

  p += `---\n\n`;
  p += `### 通用维度（所有端必分析）\n\n`;
  p += `#### 1. 功能清单与用户故事\n`;
  p += `- 功能列表（含优先级 P0/P1/P2）\n`;
  p += `- 用户故事：As a {角色}, I want {操作}, so that {价值}\n`;
  p += `- 功能边界说明（做什么、不做什么）\n\n`;
  p += `#### 2. 接口定义（API 规格）\n`;
  p += `- 接口表：方法 | 路径 | 请求参数 | 响应结构 | 状态码 | 说明\n`;
  p += `- 请求/响应示例（JSON）\n`;
  p += `- 错误码定义（按模块划分段）\n`;
  p += `- 分页/排序/过滤约定\n\n`;
  p += `#### 3. 数据模型\n`;
  p += `- 实体关系描述\n`;
  p += `- 字段级定义：字段名 | 类型 | 必填 | 默认值 | 约束 | 说明\n`;
  p += `- 枚举值定义\n\n`;
  p += `#### 4. 业务规则\n`;
  p += `- 核心业务逻辑（含边界条件和异常流）\n`;
  p += `- 状态机流转（如有）：状态 → 触发条件 → 目标状态\n`;
  p += `- 数据校验规则（前端 + 后端双重校验）\n\n`;
  p += `#### 5. 安全分析\n`;
  p += `- 认证/授权方式\n`;
  p += `- 敏感数据处理\n`;
  p += `- 端特有安全防护（见下方端专属维度）\n\n`;
  p += `#### 6. 性能与体验\n`;
  p += `- 端特有性能指标（见下方端专属维度）\n`;
  p += `- 关键性能瓶颈识别\n\n`;
  p += `#### 7. 错误处理策略\n`;
  p += `- 全局异常处理方案\n`;
  p += `- 重试/降级/熔断策略（后端）；用户可见错误提示（前端）\n\n`;
  p += `#### 8. 测试策略\n`;
  p += `- 单元/集成/E2E 测试覆盖范围\n`;
  p += `- 边界用例和异常流测试\n\n`;
  p += `#### 9. 第三方依赖\n`;
  p += `- 外部 API / SDK / 中间件（名称/版本/用途）\n`;
  p += `- 配置管理（环境变量/Feature Flag）\n\n`;
  p += `#### 10. 跨端关联点\n`;
  p += `- 该端哪些功能/接口与其他端有关联\n`;
  p += `- 数据流向（谁生产谁消费）\n`;
  p += `- 共享的数据实体和状态\n\n`;

  p += `---\n\n`;
  p += `### 端专属专业维度（按端类型追加）\n\n`;

  p += `#### 🖥 后端服务\n`;
  p += `- **数据库设计**：索引策略、分表方案、迁移脚本、慢查询优化\n`;
  p += `- **缓存策略**：缓存粒度、失效策略、穿透/雪崩防护\n`;
  p += `- **并发与事务**：QPS 预估、分布式锁、事务隔离级别\n`;
  p += `- **消息队列**：异步场景、消息可靠性、消费幂等\n`;
  p += `- **API 版本管理**：向后兼容、废弃策略\n`;
  p += `- **日志与监控**：结构化日志、链路追踪、告警规则\n`;
  p += `- **安全**：SQL 注入防护、接口鉴权、数据脱敏、日志屏蔽\n\n`;

  p += `#### 🌐 Web 管理端（Admin）\n`;
  p += `- **复杂组件**：大数据表格（虚拟滚动）、复杂表单联动、树形结构\n`;
  p += `- **权限 UI**：菜单权限、按钮权限、数据权限、页面级权限控制\n`;
  p += `- **交互效率**：键盘快捷键、批量操作、拖拽排序、快捷键\n`;
  p += `- **数据可视化**：图表组件、实时数据刷新、大屏适配\n`;
  p += `- **无障碍(a11y)**：ARIA 标签、键盘导航、屏幕阅读器兼容\n`;
  p += `- **安全**：XSS 防护、CSRF Token、接口签名、Token 安全存储\n`;
  p += `- **性能**：首屏加载、路由懒加载、打包体积优化、长列表优化\n\n`;

  p += `#### 📱 移动 H5\n`;
  p += `- **适配方案**：viewport 配置、rem/vw 适配、刘海屏/底部安全区\n`;
  p += `- **触摸交互**：手势识别、滑动冲突处理、触摸反馈、点击区域\n`;
  p += `- **首屏性能**：骨架屏、SSR/SSG、资源预加载、关键 CSS 内联\n`;
  p += `- **弱网优化**：离线缓存(PWA)、请求合并、图片懒加载、压缩策略\n`;
  p += `- **移动端兼容**：iOS/Android WebView 差异、输入法弹层、1px 边框\n`;
  p += `- **安全**：接口签名、Token 存储(localStorage vs Cookie)、URL 参数加密\n`;
  p += `- **体验**：下拉刷新、上拉加载、返回手势、页面切换动画\n\n`;

  p += `#### 🔲 小程序\n`;
  p += `- **包体积约束**：主包 2MB 限制、分包策略、资源压缩、图片 CDN 化\n`;
  p += `- **平台 API 约束**：微信/支付宝 API 差异、权限申请、审核规则\n`;
  p += `- **渲染限制**：无 DOM 操作、setData 性能优化（最小数据原则）、长列表\n`;
  p += `- **生命周期**：App/Page/Component 生命周期差异、前后台切换\n`;
  p += `- **导航**：页面栈限制(10层)、TabBar 设计、分享/扫码进入\n`;
  p += `- **安全**：接口签名、登录态管理(code2session)、数据缓存加密\n`;
  p += `- **体验**：骨架屏、自定义导航栏、下拉刷新、订阅消息\n\n`;

  p += `#### 📲 原生/混合 App\n`;
  p += `- **原生桥接**：JSBridge 设计、原生模块调用、版本兼容\n`;
  p += `- **App 生命周期**：前后台切换、内存回收、深度链接(Deep Link)\n`;
  p += `- **推送通知**：推送通道、消息分类、角标管理\n`;
  p += `- **离线能力**：本地数据库(Realm/SQLite)、离线同步策略、冲突解决\n`;
  p += `- **性能**：启动速度、内存管理、帧率优化、图片缓存\n`;
  p += `- **安全**：证书固定(Certificate Pinning)、数据加密存储、Root检测\n`;
  p += `- **应用商店**：隐私政策、权限说明、合规要求\n\n`;

  p += `## 输出格式\n\n`;
  p += `每个端输出一份完整文档，包含通用维度 10 个章节 + 端专属维度章节。\n`;
  p += `如果某个维度在当前需求中没有内容，写“暂无”而不是省略章节。\n\n`;
  p += `\`\`\`markdown\n`;
  p += `# {端名} 端需求分析\n\n`;
  p += `> 端类型: {后端服务/Web管理端/移动H5/小程序/原生App}\n\n`;
  p += `## 1. 功能清单与用户故事\n`;
  p += `| # | 功能 | 优先级 | 用户故事 | 边界 |\n|:--|:--|:--:|:--|:--|\n\n`;
  p += `## 2. 接口定义\n`;
  p += `### {模块名}\n`;
  p += `| 方法 | 路径 | 参数 | 响应 | 状态码 | 说明 |\n|:--|:--|:--|:--|:--|:--|\n\n`;
  p += `## 3. 数据模型\n`;
  p += `### {实体名}\n`;
  p += `| 字段 | 类型 | 必填 | 默认值 | 约束 | 说明 |\n|:--|:--|:--:|:--|:--|:--|\n\n`;
  p += `## 4. 业务规则\n`;
  p += `### {规则名}\n`;
  p += `- 触发条件 / 处理逻辑 / 异常流\n\n`;
  p += `## 5. 安全分析\n`;
  p += `## 6. 性能与体验\n`;
  p += `## 7. 错误处理策略\n`;
  p += `## 8. 测试策略\n`;
  p += `## 9. 第三方依赖\n`;
  p += `## 10. 跨端关联点\n\n`;
  p += `## 11. {端类型} 专业维度\n`;
  p += `> 根据端类型自动追加，如：数据库设计/权限UI/弱网优化/包体积/原生桥接等\n`;
  p += `\`\`\`\n\n`;

  p += `## 写入命令\n`;
  p += `speccore synthesize --apply-phase 1 '{分析内容}' -I ${iter}\n\n`;
  p += `## 注意\n`;
  p += `- 如果用户已在 .speccore/GLOBAL/platforms/{端名}/ 下放置了自建文档，以上分析应在其基础上补充完善，不要覆盖已有内容\n`;
  p += `- 需求以产品文档为准，不要臆造需求\n`;
  p += `- 保持原文档中的接口定义、字段说明等细节不丢失\n`;

  return p;
}

// ================================================================
// Phase 2: 跨端综合
// ================================================================
async function runPhase2(
  iter: string, iterDir: string, globalDir: string, specDir: string
): Promise<void> {
  // 读取 Phase 1 的结果（从 GLOBAL/platforms/）
  const platformsDir = join(globalDir, 'platforms');
  if (!await pathExists(platformsDir)) {
    logger.warn('未找到 Phase 1 结果，请先运行: speccore synthesize --phase 1');
    return;
  }

  // 递归读取 platforms/ 下所有端目录的 MD 文件
  const platformSpecs: { name: string; content: string }[] = [];
  const platformEntries = await readdir(platformsDir, { withFileTypes: true });
  for (const entry of platformEntries) {
    if (entry.isDirectory()) {
      const subFiles = await readdir(join(platformsDir, entry.name));
      for (const f of subFiles.filter(f => f.endsWith('.md'))) {
        const content = await readFile(join(platformsDir, entry.name, f), 'utf-8');
        platformSpecs.push({ name: `${entry.name}/${f}`, content });
      }
    } else if (entry.name.endsWith('.md')) {
      const content = await readFile(join(platformsDir, entry.name), 'utf-8');
      platformSpecs.push({ name: entry.name, content });
    }
  }
  if (platformSpecs.length === 0) {
    logger.warn('Phase 1 结果为空，请先运行: speccore synthesize --phase 1');
    return;
  }

  // 也读取已有的 020-specs/ 下的其他文件作为补充
  const existingSpecs: { name: string; content: string }[] = [];
  if (await pathExists(specDir)) {
    const specFiles = await readdir(specDir);
    for (const f of specFiles.filter(f => f.endsWith('.md') && !['platforms', 'synthesis', 'snapshots'].includes(f))) {
      const content = await readFile(join(specDir, f), 'utf-8');
      existingSpecs.push({ name: f, content });
    }
  }

  // 也读取 GLOBAL/synthesis/ 下用户自建的文档作为补充
  const synthesisDir = join(globalDir, 'synthesis');
  if (await pathExists(synthesisDir)) {
    const synFiles = await readdir(synthesisDir);
    for (const f of synFiles.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
      const content = await readFile(join(synthesisDir, f), 'utf-8');
      existingSpecs.push({ name: `GLOBAL/synthesis/${f}`, content });
    }
  }

  const prompt = buildPhase2Prompt(iter, platformSpecs, existingSpecs);
  process.stdout.write(`[SPECCORE_PHASE2]\n${prompt}`);
  process.exitCode = 11;
}

function buildPhase2Prompt(
  iter: string,
  platformSpecs: { name: string; content: string }[],
  existingSpecs: { name: string; content: string }[]
): string {
  let p = `# Phase 2: 跨端综合分析\n\n`;
  p += `## 目标\n`;
  p += `基于迭代「${iter}」各端的独立分析结果，进行跨端综合，生成：\n`;
  p += `1. **CROSS_PLATFORM.md** — 跨端业务关系图 + 接口映射\n`;
  p += `2. **ARCHITECTURE.md** — 全量架构文档\n`;
  p += `3. **TECH_FULL.md** — 全量技术方案\n\n`;

  p += `## 各端分析结果\n\n`;
  for (const spec of platformSpecs) {
    p += `### ${spec.name}\n\n`;
    p += spec.content.slice(0, 8000);
    p += `\n\n---\n\n`;
  }

  if (existingSpecs.length > 0) {
    p += `## 已有技术文档（补充参考）\n\n`;
    for (const spec of existingSpecs.slice(0, 3)) {
      p += `### ${spec.name}\n\n`;
      p += spec.content.slice(0, 3000);
      p += `\n\n---\n\n`;
    }
  }

  p += `## 分析要求（业内专业级）\n\n`;

  p += `### CROSS_PLATFORM.md — 跨端业务关系\n\n`;
  p += `1. **跨端调用关系图**（Mermaid sequenceDiagram/flowchart）\n`;
  p += `2. **接口映射表**：前端操作 → 后端接口 → 数据表，标注所属端\n`;
  p += `3. **数据流向图**：哪些数据在哪些端之间流动，谁是生产者谁是消费者\n`;
  p += `4. **共享实体识别**：哪些数据模型被多端共享，状态同步策略\n`;
  p += `5. **跨端事务一致性**：涉及多端操作的业务流程，如何保证一致性\n`;
  p += `6. **冲突与风险**：接口不匹配、数据格式差异、版本不一致等\n\n`;

  p += `### ARCHITECTURE.md — 全量架构文档\n\n`;
  p += `1. **系统架构图**（Mermaid）：含所有端、服务、中间件、数据库\n`;
  p += `2. **服务依赖关系**：调用方向、协议（HTTP/gRPC/MQ）、同步/异步\n`;
  p += `3. **技术栈汇总**：每层的语言/框架/版本/选型理由\n`;
  p += `4. **部署架构**：容器化/编排/环境划分（dev/staging/prod）\n`;
  p += `5. **ADR（架构决策记录）**：关键决策的背景、方案对比、最终选择、理由\n`;
  p += `6. **安全架构**：认证链路、授权模型、数据加密方案、API 网关策略\n`;
  p += `7. **监控告警**：关键指标（QPS/延迟/错误率）、SLA 目标、告警阈值\n`;
  p += `8. **容灾方案**：降级策略、熔断规则、回滚预案、数据备份策略\n\n`;

  p += `### TECH_FULL.md — 全量技术方案\n\n`;
  p += `1. **全量技术方案**：综合各端的实现方案，提取公共部分\n`;
  p += `2. **公共模块/组件识别**：哪些逻辑多端共享，如何复用\n`;
  p += `3. **跨端共享数据模型**：统一的数据定义、类型映射\n`;
  p += `4. **API 版本策略**：向后兼容方案、废弃计划\n`;
  p += `5. **容量规划**：存储增长预估、带宽需求、并发上限\n`;
  p += `6. **数据一致性方案**：分布式事务/最终一致/事件驱动\n`;
  p += `7. **性能优化策略**：缓存层、CDN、数据库优化、异步处理\n`;
  p += `8. **技术风险和约束**：已知风险、技术债、外部依赖风险\n\n`;

  p += `## 输出格式\n\n`;
  p += `请将三个文档用以下分隔标记分开：\n`;
  p += `\`\`\`\n`;
  p += `===CROSS_PLATFORM===\n{CROSS_PLATFORM.md 内容}\n`;
  p += `===ARCHITECTURE===\n{ARCHITECTURE.md 内容}\n`;
  p += `===TECH_FULL===\n{TECH_FULL.md 内容}\n`;
  p += `\`\`\`\n\n`;

  p += `## 写入命令\n`;
  p += `speccore synthesize --apply-phase 2 '{综合内容}' -I ${iter}\n\n`;
  p += `## 注意\n`;
  p += `- 如果用户已在 .speccore/GLOBAL/synthesis/ 下放置了自建文档，应优先参考其内容\n`;
  p += `- 三个文档都必须输出，用分隔标记分开\n`;
  p += `- 不要省略任何内容，每个章节都要完整\n`;

  return p;
}

// ================================================================
// Phase 3: 按功能单元合成需求文档
// ================================================================
async function runPhase3(
  iter: string, iterDir: string, globalDir: string, specDir: string,
  reqDir: string, convDir: string, withCode?: boolean
): Promise<void> {
  // 收集所有可用输入：GLOBAL 层各端 specs + 跨端综合 + 迭代层 specs + 原始需求文档
  const allSpecs: { name: string; content: string }[] = [];

  // Phase 1 结果（从 GLOBAL/platforms/）
  const platformsDir = join(globalDir, 'platforms');
  if (await pathExists(platformsDir)) {
    const platformEntries = await readdir(platformsDir, { withFileTypes: true });
    for (const entry of platformEntries) {
      if (entry.isDirectory()) {
        const subFiles = await readdir(join(platformsDir, entry.name));
        for (const f of subFiles.filter(f => f.endsWith('.md'))) {
          const content = await readFile(join(platformsDir, entry.name, f), 'utf-8');
          allSpecs.push({ name: `GLOBAL/platforms/${entry.name}/${f}`, content });
        }
      } else if (entry.name.endsWith('.md')) {
        const content = await readFile(join(platformsDir, entry.name), 'utf-8');
        allSpecs.push({ name: `GLOBAL/platforms/${entry.name}`, content });
      }
    }
  }

  // Phase 2 结果（从 GLOBAL/synthesis/）
  const synthesisDir = join(globalDir, 'synthesis');
  if (await pathExists(synthesisDir)) {
    for (const f of (await readdir(synthesisDir)).filter(f => f.endsWith('.md'))) {
      allSpecs.push({ name: `GLOBAL/synthesis/${f}`, content: await readFile(join(synthesisDir, f), 'utf-8') });
    }
  }

  // 原始需求文档
  const sourceDocs: { name: string; content: string }[] = [];
  if (await pathExists(convDir)) {
    for (const f of (await readdir(convDir)).filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
      sourceDocs.push({ name: f, content: await readFile(join(convDir, f), 'utf-8') });
    }
  }
  // features/ 下
  const featuresDir = join(reqDir, 'features');
  if (await pathExists(featuresDir)) {
    for (const e of await readdir(featuresDir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const readme = join(featuresDir, e.name, 'README.md');
        if (await pathExists(readme)) {
          sourceDocs.push({ name: `features/${e.name}/README.md`, content: await readFile(readme, 'utf-8') });
        }
      }
    }
  }

  if (allSpecs.length === 0 && sourceDocs.length === 0) {
    logger.warn('无可用输入文档，请先运行 Phase 1 和 Phase 2');
    return;
  }

  const prompt = buildPhase3Prompt(iter, allSpecs, sourceDocs);
  process.stdout.write(`[SPECCORE_PHASE3]\n${prompt}`);
  process.exitCode = 12;
}

function buildPhase3Prompt(
  iter: string,
  allSpecs: { name: string; content: string }[],
  sourceDocs: { name: string; content: string }[]
): string {
  let p = `# Phase 3: 按功能单元合成需求文档\n\n`;
  p += `## 目标\n`;
  p += `基于迭代「${iter}」的全量分析结果，按**功能单元**组织合成综合需求文档。\n`;
  p += `每个功能单元一个章节，包含该功能关联的所有端的需求。\n\n`;

  p += `## 输入：全量分析结果\n\n`;
  for (const spec of allSpecs) {
    p += `### ${spec.name}\n\n`;
    p += spec.content.slice(0, 6000);
    p += `\n\n---\n\n`;
  }

  if (sourceDocs.length > 0) {
    p += `## 输入：原始需求文档\n\n`;
    for (const doc of sourceDocs) {
      p += `### ${doc.name}\n\n`;
      p += doc.content.slice(0, 4000);
      p += `\n\n---\n\n`;
    }
  }

  p += `## 合成原则（业内专业级）\n\n`;
  p += `1. **按功能单元组织**：一个功能单元一个章节，不按端拆分\n`;
  p += `2. **全端聚合**：每个功能单元包含所有相关端的需求\n`;
  p += `3. **公共逻辑只写一次**：多端共享的逻辑放在章节开头\n`;
  p += `4. **端差异用子标题**：\`#### {端名} 端\` 子标题标出差异\n`;
  p += `5. **接口汇总**：同一功能的接口放一起，用表格标注所属端\n`;
  p += `6. **冲突标记**：需求矛盾用 ⚠️ 标注，汇总到“待确认事项”\n\n`;
  
  p += `## 每个功能单元必须包含的内容\n\n`;
  p += `### A. 用户故事与验收标准\n`;
  p += `- 用户故事：As a {角色}, I want {操作}, so that {价值}\n`;
  p += `- 验收标准（Given/When/Then 格式）：\n`;
  p += `  - Given {前置条件}, When {操作}, Then {预期结果}\n\n`;
  p += `### B. 各端需求详情\n`;
  p += `- 后端：API 定义、数据模型、业务规则、错误码\n`;
  p += `- 前端：页面/组件/路由/交互逻辑/状态管理\n`;
  p += `- 管理端：管理页面/操作流程/权限控制\n\n`;
  p += `### C. 接口汇总\n`;
  p += `- 统一接口表格：方法 | 路径 | 说明 | 端 | 状态码\n`;
  p += `- 请求/响应示例（JSON）\n\n`;
  p += `### D. 数据字典\n`;
  p += `- 字段级定义：字段名 | 类型 | 必填 | 默认值 | 约束 | 枚举值 | 说明\n`;
  p += `- 状态机流转（如有）：状态 → 触发条件 → 目标状态\n\n`;
  p += `### E. 非功能需求\n`;
  p += `- 性能要求（响应时间/并发量）\n`;
  p += `- 安全要求（认证/授权/数据保护）\n`;
  p += `- 兼容性要求（浏览器/设备/系统版本）\n`;
  p += `- 可用性要求（SLA/容灾）\n\n`;
  p += `### F. 测试要点\n`;
  p += `- 关键测试场景\n`;
  p += `- 边界用例\n`;
  p += `- 跨端集成测试点\n\n`;

  p += `## 输出结构\n\n`;
  p += `\`\`\`markdown\n`;
  p += `# ${iter} 迭代综合需求文档\n\n`;
  p += `> 全量分析合成 | 生成时间: {当前日期}\n\n`;
  p += `## 1. 需求概述\n`;
  p += `> 整体业务背景、目标用户、核心场景、成功指标\n\n`;
  p += `## 2. 功能单元\n\n`;
  p += `### 2.1 {功能单元名}\n\n`;
  p += `#### 用户故事\n`;
  p += `- As a {角色}, I want {操作}, so that {价值}\n\n`;
  p += `#### 验收标准\n`;
  p += `- Given {前置}, When {操作}, Then {结果}\n\n`;
  p += `#### 后端\n`;
  p += `- API 定义、数据模型、业务规则、错误码\n\n`;
  p += `#### Web 前端\n`;
  p += `- 页面、组件、交互逻辑\n\n`;
  p += `#### Admin 端\n`;
  p += `- 管理页面、操作流程\n\n`;
  p += `#### 接口汇总\n`;
  p += `| 方法 | 路径 | 说明 | 端 | 状态码 |\n|:--|:--|:--|:--|:--|\n\n`;
  p += `#### 数据字典\n`;
  p += `| 字段 | 类型 | 必填 | 默认值 | 约束 | 枚举值 | 说明 |\n|:--|:--|:--:|:--|:--|:--|:--|\n\n`;
  p += `#### 非功能需求\n`;
  p += `- 性能 / 安全 / 兼容性\n\n`;
  p += `#### 测试要点\n`;
  p += `- 关键场景 / 边界用例\n\n`;
  p += `### 2.2 {功能单元名}\n`;
  p += `...\n\n`;
  p += `## 3. 全局非功能需求\n`;
  p += `> 跨功能单元的公共要求（性能/安全/可用性/兼容性）\n\n`;
  p += `## 4. ⚠️ 待确认事项\n`;
  p += `> 自动检测到的冲突、缺失、不一致\n`;
  p += `\`\`\`\n\n`;

  p += `## 要求\n`;
  p += `1. 功能单元必须是业务维度的划分（不是技术维度）\n`;
  p += `2. 每个功能单元必须包含所有相关端的需求\n`;
  p += `3. 接口必须汇总，标注所属端\n`;
  p += `4. 输出完整 Markdown，不省略\n\n`;

  p += `## 写入命令\n`;
  p += `speccore synthesize --apply-phase 3 '{合成内容}' -I ${iter}\n\n`;
  p += `## 注意\n`;
  p += `- 如果用户已在 010-requirements/ 下放置了自建需求文档，应优先参考其内容\n`;
  p += `- 需求以产品文档为准，不要臆造需求\n`;

  return p;
}

// ================================================================
// 生成 GLOBAL/INDEX.md 轻量索引
// ================================================================
async function generateGlobalIndex(globalDir: string): Promise<void> {
  const synthesisDir = join(globalDir, 'synthesis');
  const platformsDir = join(globalDir, 'platforms');
  const lines: string[] = [];

  lines.push(`# 全局知识库索引`);
  lines.push(`> 自动生成于 ${new Date().toISOString().split('T')[0]}，供 split/execute/analyze 智能注入\n`);

  // 工程列表
  lines.push(`## 工程列表\n`);
  try {
    const entries = await parseConstitution();
    for (const e of entries) {
      lines.push(`- **${e.project}** (${e.srcPath}) → 端: ${e.platforms.join(', ')}`);
    }
  } catch { /* ignore */ }
  lines.push('');

  // 各端摘要
  if (await pathExists(platformsDir)) {
    lines.push(`## 各端分析文档\n`);
    const entries = await readdir(platformsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const files = await readdir(join(platformsDir, entry.name));
        const mdFiles = files.filter(f => f.endsWith('.md') && !isTimestampBackup(f));
        lines.push(`- **${entry.name}** (${mdFiles.length} 个文档)`);
      }
    }
    lines.push('');
  }

  // synthesis 文档摘要
  if (await pathExists(synthesisDir)) {
    lines.push(`## 跨端综合文档\n`);
    const files = await readdir(synthesisDir);
    for (const f of files.filter(f => f.endsWith('.md') && !isTimestampBackup(f))) {
      const content = await readFile(join(synthesisDir, f), 'utf-8');
      const firstSection = content.match(/##\s+(.+)/);
      lines.push(`- **${f}**${firstSection ? ` — ${firstSection[1]}` : ''}`);
    }
    lines.push('');
  }

  // 写入
  const indexPath = join(globalDir, 'INDEX.md');
  await writeFile(indexPath, lines.join('\n'));
  logger.info(`   📇 全局索引已生成: .speccore/GLOBAL/INDEX.md`);
}

// ================================================================
// 简单合成（向后兼容）
// ================================================================
async function runSimpleSynthesize(
  iter: string, iterDir: string, reqDir: string, convDir: string,
  outputPath: string, withCode?: boolean
): Promise<void> {
  const sourceDocs: { name: string; content: string }[] = [];

  if (await pathExists(convDir)) {
    const files = await readdir(convDir);
    const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('README') && !isTimestampBackup(f));
    for (const f of mdFiles) {
      const content = await readFile(join(convDir, f), 'utf-8');
      sourceDocs.push({ name: f, content });
    }
  }

  const featuresDir = join(reqDir, 'features');
  if (await pathExists(featuresDir)) {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const readme = join(featuresDir, e.name, 'README.md');
        if (await pathExists(readme)) {
          const content = await readFile(readme, 'utf-8');
          sourceDocs.push({ name: `features/${e.name}/README.md`, content });
        }
      }
    }
  }

  if (sourceDocs.length === 0) {
    logger.warn('未找到需求文档，请先导入: speccore doc2spec -f <文件> --iter <迭代名>');
    return;
  }

  let existingReq = '';
  if (await pathExists(outputPath)) {
    existingReq = await readFile(outputPath, 'utf-8');
  }

  let indexContent = '';
  const indexPath = join(reqDir, 'INDEX.md');
  if (await pathExists(indexPath)) {
    indexContent = await readFile(indexPath, 'utf-8');
  }

  const prompt = buildSynthesizePrompt(iter, sourceDocs, existingReq, indexContent, withCode);
  process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
  process.exitCode = 10;
}

function buildSynthesizePrompt(
  iteration: string,
  sourceDocs: { name: string; content: string }[],
  existingReq: string,
  indexContent: string,
  withCode?: boolean
): string {
  const docList = sourceDocs.map(d => `### ${d.name}\n\n${d.content}`).join('\n\n---\n\n');

  let prompt = `# 任务: synthesize (需求文档智能合成)\n\n`;
  prompt += `## 目标\n`;
  prompt += `将迭代「${iteration}」的 ${sourceDocs.length} 份需求文档智能合并为一篇原子化的综合需求文档。\n\n`;

  if (existingReq) {
    prompt += `## 现有 REQUIREMENT.md\n`;
    prompt += `以下是当前已有的综合需求文档（可能是旧版或机械拼接版），请在此基础上改进：\n\n`;
    const truncated = existingReq.length > 3000 ? existingReq.slice(0, 3000) + '\n...（内容过长，已截断）' : existingReq;
    prompt += '```markdown\n' + truncated + '\n```\n\n';
  }

  prompt += `## 输入文档\n\n`;
  prompt += docList;
  prompt += `\n\n`;

  if (indexContent) {
    prompt += `## 需求索引\n\n`;
    prompt += '```markdown\n' + indexContent + '\n```\n\n';
  }

  prompt += `## 合成原则\n\n`;
  prompt += `1. **章节需求原子化**：一个业务功能一个章节，不按端拆分。例如"用户管理"是一个章节，admin/h5/小程序的差异放在子节\n`;
  prompt += `2. **公共优先**：多端共享的逻辑只写一次，放在章节开头\n`;
  prompt += `3. **差异标注**：端差异用 \`#### {端名} 端\` 子标题明确标出\n`;
  prompt += `4. **接口汇总**：同一功能的接口放一起，用表格标注所属端（方法|路径|说明|端）\n`;
  prompt += `5. **冲突标记**：需求间矛盾或描述不一致时用 \`⚠️\` 标注，汇总到"待确认事项"章节\n`;
  prompt += `6. **去重合并**：相同描述只保留一份，非功能需求（性能、安全等）各端一样就合并\n`;
  prompt += `7. **统一结构**：每个原子章节遵循：概述 → 功能描述 → 接口定义 → 验收标准 → 端差异\n\n`;

  prompt += `## 输出结构\n\n`;
  prompt += `\`\`\`markdown\n`;
  prompt += `# ${iteration} 迭代综合需求文档\n\n`;
  prompt += `> 由 ${sourceDocs.map(d => d.name).join('、')} 自动合成\n`;
  prompt += `> 合成时间: {当前日期}\n\n`;
  prompt += `## 1. 需求概述\n`;
  prompt += `> 整体业务背景、目标用户、核心场景\n\n`;
  prompt += `## 2. 功能模块\n`;
  prompt += `### 2.1 {功能名}\n`;
  prompt += `> 公共逻辑描述\n\n`;
  prompt += `| 方法 | 路径 | 说明 | 端 |\n|:--|:--|:--|:--|\n\n`;
  prompt += `#### {端名} 端差异\n`;
  prompt += `- 特有功能点\n\n`;
  prompt += `### 2.2 {功能名}\n`;
  prompt += `...\n\n`;
  prompt += `## 3. 非功能需求\n`;
  prompt += `> 合并各端共同的非功能要求（性能、安全、兼容性等）\n\n`;
  prompt += `## 4. ⚠️ 待确认事项\n`;
  prompt += `> 自动检测到的冲突、缺失、不一致\n`;
  prompt += `- {冲突描述}\n`;
  prompt += `\`\`\`\n\n`;

  prompt += `## 要求\n`;
  prompt += `1. 仔细阅读所有输入文档，理解每个功能的完整描述\n`;
  prompt += `2. 按业务模块（而非端）组织章节，同一功能的不同端实现放在同一章节下\n`;
  prompt += `3. 接口表格必须汇总，标注每个接口属于哪个端\n`;
  prompt += `4. 发现矛盾或不一致时，在文档末尾"待确认事项"中列出\n`;
  prompt += `5. 输出完整的 Markdown 文档，不要省略任何内容\n`;
  prompt += `6. 写入: speccore synthesize --apply '{合成的完整Markdown内容}' -I ${iteration}\n\n`;

  prompt += `## 注意\n`;
  prompt += `- 需求以产品文档为准，不要臆造需求\n`;
  prompt += `- 如果某个功能只在某一端出现，仍然作为独立章节，标注"仅 {端名} 端"\n`;
  prompt += `- 保持原文档中的接口定义、字段说明等细节不丢失\n`;

  return prompt;
}
