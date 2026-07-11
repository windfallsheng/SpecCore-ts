import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';

/**
 * 上下文管理器 — 从 .speccore 配置中自动检测当前期次、执行人等信息。
 */
export class ContextManager {
  constructor(private projectRoot: string) {}

  /** 读取文件内容，文件不存在返回 null */
  private readFile(relativePath: string): string | null {
    const fullPath = resolve(this.projectRoot, relativePath);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, 'utf-8');
  }

  /** 从 ITERATIONS/README.md 或 context.json 获取当前期次 */
  getCurrentIteration(): string | null {
    // 1. 优先从 context.json 读取
    const ctxPath = join(this.projectRoot, '.speccore', 'local', 'context.json');
    if (existsSync(ctxPath)) {
      try {
        const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
        if (ctx?.current_iteration) return ctx.current_iteration;
      } catch { /* ignore parse error */ }
    }

    // 2. 扫描 ITERATIONS/README.md 中标记为 🔄 进行中的期次
    const iterReadme = this.readFile('.speccore/ITERATIONS/README.md');
    if (iterReadme) {
      const match = iterReadme.match(/🔄\s*[|│]\s*(期次-\S+|\d{4}-\d{2}-\S+)/);
      if (match) return match[1];
      // Try without pipe separator
      const match2 = iterReadme.match(/🔄\s*(期次-\S+|\d{4}-\d{2}-\S+)/);
      if (match2) return match2[1];
    }

    // 3. 扫描项目根目录下的期次目录
    try {
      const { readdirSync } = require('fs');
      const entries = readdirSync(this.projectRoot);
      const iterations = entries
        .filter((e: string) => e.startsWith('期次-'))
        .sort()
        .reverse();
      if (iterations.length > 0) return iterations[0];
    } catch { /* ignore */ }

    return null;
  }

  /** 从 git config 获取当前执行人 */
  getCurrentAssignee(): string {
    const { execSync } = require('child_process');
    try {
      const name = execSync('git config user.name', { encoding: 'utf-8', cwd: this.projectRoot }).trim();
      if (name) return name;
    } catch { /* fallback */ }
    return '未指定';
  }

  /** 从 context.json 获取当前 Task */
  getCurrentTask(): string | null {
    const ctxPath = join(this.projectRoot, '.speccore', 'local', 'context.json');
    if (existsSync(ctxPath)) {
      try {
        const ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
        if (ctx?.current_task) return ctx.current_task;
      } catch { /* ignore */ }
    }
    return null;
  }

  /** 获取当前项目的所有平台配置 */
  getPlatforms(): string[] {
    const platformsPath = join(this.projectRoot, '.speccore', 'config', 'platforms.yaml');
    if (!existsSync(platformsPath)) return ['web', 'h5', 'miniapp'];

    const content = readFileSync(platformsPath, 'utf-8');
    const platforms: string[] = [];
    const matches = content.matchAll(/^\s{2}(\w+):/gm);
    for (const m of matches) {
      if (!['platforms', 'web', 'h5', 'miniapp'].includes(m[1]) || m[1] !== 'platforms') {
        if (m[1] !== 'platforms') platforms.push(m[1]);
      }
    }

    // Simple YAML top-level extraction
    const sections = content.match(/^\w+:/gm);
    if (sections?.includes('platforms:')) {
      const keys = content.match(/^\s{2}(\w+):/gm);
      if (keys) {
        const platformKeys = keys
          .map(k => k.trim().replace(':', ''))
          .filter(k => k !== 'platforms');
        return [...new Set(platformKeys)].length > 0
          ? [...new Set(platformKeys)]
          : ['web', 'h5', 'miniapp'];
      }
    }

    return platforms.length > 0 ? platforms : ['web', 'h5', 'miniapp'];
  }

  /** 获取完整上下文快照 */
  getSnapshot(): {
    iteration: string | null;
    assignee: string;
    task: string | null;
    platforms: string[];
    projectRoot: string;
  } {
    return {
      iteration: this.getCurrentIteration(),
      assignee: this.getCurrentAssignee(),
      task: this.getCurrentTask(),
      platforms: this.getPlatforms(),
      projectRoot: this.projectRoot,
    };
  }
}
