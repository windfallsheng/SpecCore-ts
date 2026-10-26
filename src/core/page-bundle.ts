/**
 * HTML 页面家族联动生成（v8.3.342+）
 *
 * 背景：welcome / ask / init 等命令弹出的 HTML 页面之间存在相对跳转
 * （如项目名片 → ask 引导页 → 四个模式页 → 帮助页），此前各命令只生成
 * 自己的主页面，跳转目标依赖其他命令跑过——首次使用某个命令时点击
 * 链接即 404，或 outputs/ 被清理后链路永久断掉（ask 的版本 marker 还在）。
 *
 * 本模块提供幂等的页面家族补齐：任何入口命令生成主页面后调用
 * ensureXxx，保证跳转目标必达。所有联动失败均不阻断主流程。
 *
 * 注意：对 ask.ts 采用运行时动态 import，避免 static 循环依赖
 * （ask.ts 会静态 import 本模块）。
 */
import { join, basename } from 'path';
import { pathExists, ensureDir, writeFile, copy, readFile } from 'fs-extra';

/** 包内 HTML 模板目录（dist/core → 包根 templates/html，与 ask/init 现有定位同源） */
export function htmlTemplateDir(): string {
  return join(__dirname, '..', '..', 'templates', 'html');
}

/** ask 引导页跳转的四个模式页 */
export const ASK_MODE_PAGES: readonly string[] = [
  'speccore-ask-explain.html',
  'speccore-ask-guide.html',
  'speccore-ask-match.html',
  'speccore-ask-pipeline.html',
];

/** 从包内模板复制单个 HTML 到项目 outputs/（存在才复制，幂等覆盖） */
export async function copyHtmlTemplate(cwd: string, file: string): Promise<string> {
  const src = join(htmlTemplateDir(), file);
  const dest = join(cwd, 'outputs', file);
  await ensureDir(join(cwd, 'outputs'));
  if (await pathExists(src)) await copy(src, dest);
  return dest;
}

/** 联动生成提示词库页（失败不阻断主流程） */
export async function ensurePromptsPage(cwd: string): Promise<void> {
  try {
    const { generatePromptsPage } = await import('../commands/prompts');
    await generatePromptsPage(join(cwd, 'outputs', 'speccore-prompts.html'));
  } catch { /* 联动失败不阻断 */ }
}

/**
 * 幂等生成 ask 引导页家族：
 * onboarding 主页面 + 四个模式页 + 帮助页（onboarding 的跳转目标全部补齐）
 * 返回 onboarding 页面路径，供 [SPECCORE_ONBOARD] 标记使用。
 */
export async function ensureAskPages(cwd: string): Promise<string> {
  const { renderOnboardingHtml } = await import('../commands/ask');
  const html = renderOnboardingHtml();
  const outPath = join(cwd, 'outputs', 'speccore-ask-onboarding.html');
  await ensureDir(join(cwd, 'outputs'));
  await writeFile(outPath, html);
  for (const f of [...ASK_MODE_PAGES, 'speccore-help.html']) {
    await copyHtmlTemplate(cwd, f);
  }
  await ensurePromptsPage(cwd);
  return outPath;
}

/**
 * 幂等生成项目配置引导页（setup-guide 内「查看提示词库」链接 → prompts，
 * 两者一起补齐）。返回 setup-guide 页面路径。
 */
export async function ensureSetupGuidePage(cwd: string, projectName?: string, pkgVersion?: string): Promise<string> {
  const name = projectName || basename(cwd);
  const templatePath = join(htmlTemplateDir(), 'speccore-setup-guide.html');
  let template: string;
  if (await pathExists(templatePath)) {
    template = await readFile(templatePath, 'utf-8');
  } else {
    // 降级：模板缺失时给出可读提示（不应该发生）
    template = '<!DOCTYPE html><html><body><h1>SpecCore 配置引导</h1><p>模板文件缺失，请检查包内 templates/html/speccore-setup-guide.html</p></body></html>';
  }
  const html = template
    .replace(/\{\{PROJECT_NAME\}\}/g, name)
    .replace(/\{\{VERSION\}\}/g, pkgVersion || '0.0.0');

  const outputPath = join(cwd, 'outputs', 'speccore-setup-guide.html');
  await ensureDir(join(cwd, 'outputs'));
  await writeFile(outputPath, html);
  await ensurePromptsPage(cwd);
  return outputPath;
}

/**
 * 幂等补齐项目名片（welcome 页）的全部跳转目标：
 * onboarding 家族（含帮助页 + 提示词库）；已初始化项目再补配置引导页。
 */
export async function ensureWelcomeTargets(cwd: string, isInit: boolean): Promise<void> {
  await ensureAskPages(cwd);
  if (isInit) {
    let pkgVersion = '0.0.0';
    try {
      const pkg = await readFile(join(cwd, 'package.json'), 'utf-8');
      pkgVersion = JSON.parse(pkg).version || pkgVersion;
    } catch { /* 读不到用默认 */ }
    await ensureSetupGuidePage(cwd, basename(cwd), pkgVersion);
  }
}
