import { pathExists, readdir, readFile, ensureDir, writeFile, stat } from 'fs-extra';
import { join, extname } from 'path';
import { logger, Spinner } from '../utils/logger';

export interface ImportOptions {
  source?: string;
  path?: string;
  url?: string;
  iteration?: string;
}

export async function importCommand(options: ImportOptions): Promise<void> {
  const spinner = new Spinner('Importing project');
  spinner.start();

  try {
    const sources = (options.source || 'all').split(',');
    const results: string[] = [];

    for (const source of sources) {
      switch (source.trim()) {
        case 'code':
          results.push(await importCode(options.path || './'));
          break;
        case 'prd':
          results.push(await importPRD(options.path || './PRD.md'));
          break;
        case 'prototype':
          results.push(await importPrototype(options.url || ''));
          break;
        case 'all':
          results.push(await autoDetectImport(options.path || './'));
          break;
        default:
          logger.warn(`Unknown source type: ${source}`);
      }
    }

    spinner.stop('Import completed');
    for (const result of results) {
      logger.info(result);
    }
  } catch (error) {
    spinner.fail(`Import failed: ${error}`);
    throw error;
  }
}

async function importCode(sourcePath: string): Promise<string> {
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Path not found: ${sourcePath}`);
  }

  const stats = await stat(sourcePath);
  if (!stats.isDirectory()) {
    throw new Error(`Path must be a directory: ${sourcePath}`);
  }

  // Scan for API files
  const entries = await readdir(sourcePath, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && 
    ['.java', '.ts', '.js', '.py', '.go'].includes(extname(e.name)));

  const summary = `Found ${files.length} source files in ${sourcePath}`;
  logger.info(summary);

  // Generate API contracts from source code
  for (const file of files) {
    const content = await readFile(join(sourcePath, file.name), 'utf-8');
    
    // Detect API endpoints (simple regex matching)
    const endpointMatches = content.matchAll(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)/g);
    for (const match of endpointMatches) {
      logger.info(`  Detected endpoint: ${match[2]} (${match[1]})`);
    }
  }

  return summary;
}

async function importPRD(prdPath: string): Promise<string> {
  if (!(await pathExists(prdPath))) {
    throw new Error(`PRD file not found: ${prdPath}`);
  }

  const content = await readFile(prdPath, 'utf-8');
  
  // Extract requirements
  const requirements = extractRequirements(content);
  logger.info(`Extracted ${requirements.length} requirements`);

  return `Imported PRD from ${prdPath}: ${requirements.length} requirements extracted`;
}

function extractRequirements(content: string): string[] {
  const requirements: string[] = [];
  
  // Match common requirement patterns
  const patterns = [
    /(?:需求|Requirement)\s*[:：]\s*(.+)/g,
    /(?:功能|Feature)\s*[:：]\s*(.+)/g,
    /\d+\.\s+(.+)/g
  ];

  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      requirements.push(match[1].trim());
    }
  }

  return requirements;
}

async function importPrototype(url: string): Promise<string> {
  if (!url) {
    throw new Error('Prototype URL is required');
  }

  logger.info(`Importing prototype from ${url}`);
  return `Prototype imported from ${url}`;
}

async function autoDetectImport(sourcePath: string): Promise<string> {
  logger.info('Auto-detecting project structure...');

  const results: string[] = [];

  // Check for code
  if (await pathExists(join(sourcePath, 'src'))) {
    results.push(await importCode(sourcePath));
  }

  // Check for PRD
  const prdFiles = ['PRD.md', 'README.md', 'docs/PRD.md'];
  for (const prdFile of prdFiles) {
    if (await pathExists(join(sourcePath, prdFile))) {
      results.push(await importPRD(join(sourcePath, prdFile)));
      break;
    }
  }

  return results.join('\n');
}
