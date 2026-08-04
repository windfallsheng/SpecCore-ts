/**
 * global-artifacts — 全局分析时从源码反推技术栈、代码索引、需求框架
 */
import { writeFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export async function generateGlobalArtifacts(sources: string[], depth: string): Promise<void> {
  const globalDir = join('.speccore', 'GLOBAL');
  await ensureDir(globalDir);
  const now = new Date().toISOString().split('T')[0];

  // TECH_STACK.md
  const techStack = await detectTechStack(sources);
  await writeFile(join(globalDir, 'TECH_STACK.md'), [
    '# 统一技术栈注册表',
    '> 自动检测 | ' + now,
    '',
    techStack || '_未检测到明确的技术栈_',
  ].join('\n'));

  // CODE_INDEX.md
  await writeFile(join(globalDir, 'CODE_INDEX.md'), [
    '# 全局代码索引',
    '> 自动生成 | ' + now,
    '',
    '| 工程路径 | 语言 | 框架 | 说明 |',
    '| :--- | :--- | :--- | :--- |',
    ...sources.map(s => '| `' + s + '` | _待分析_ | _待分析_ | -- |'),
  ].join('\n'));

  // REQUIREMENT.md
  await writeFile(join(globalDir, 'REQUIREMENT.md'), [
    '# 全局需求概览',
    '> 从源码反推 | ' + now,
    '',
    '## 检测到的工程',
    ...sources.map(s => '- `' + s + '`'),
    '',
    '## 待确认的功能模块',
    '> 请 AI 读取代码后补充各工程的核心功能模块',
  ].join('\n'));

  logger.info('   📄 全局配置: TECH_STACK.md + CODE_INDEX.md + REQUIREMENT.md');
}

async function detectTechStack(sources: string[]): Promise<string> {
  const fs = require('fs');
  const lines: string[] = [];

  for (const dir of sources) {
    const pkgPath = join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const frameworks: string[] = [];
        if (deps['react']) frameworks.push('React');
        if (deps['vue']) frameworks.push('Vue ');
        if (deps['@angular/core']) frameworks.push('Angular');
        if (deps['express']) frameworks.push('Express');
        if (deps['next']) frameworks.push('Next.js');
        if (deps['@nestjs/core']) frameworks.push('NestJS');
        lines.push('**' + dir + '**: Node.js ' + (frameworks.length > 0 ? frameworks.join(' + ') : '(通用)'));
      } catch {}
    }

    const pomPath = join(dir, 'pom.xml');
    if (fs.existsSync(pomPath)) {
      const pom = fs.readFileSync(pomPath, 'utf-8');
      const isSpring = pom.includes('spring-boot') || pom.includes('springframework');
      lines.push('**' + dir + '**: Java ' + (isSpring ? 'Spring Boot' : '(通用)'));
    }

    if (fs.existsSync(join(dir, 'go.mod'))) {
      lines.push('**' + dir + '**: Go');
    }

    if (fs.existsSync(join(dir, 'requirements.txt')) || fs.existsSync(join(dir, 'setup.py'))) {
      lines.push('**' + dir + '**: Python');
    }
  }

  return lines.join('\n') || '| 工程 | 语言 |\n| :--- | :--- |\n' + sources.map(s => '| ' + s + ' | 未检测到 |').join('\n');
}
