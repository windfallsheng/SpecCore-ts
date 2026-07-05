import { pathExists, readdir, readFile, writeFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export interface TemplateData {
  [key: string]: string | number | boolean;
}

/**
 * Simple template engine that replaces {{key}} placeholders
 */
export class TemplateEngine {
  private templatesDir: string;

  constructor(templatesDir: string) {
    this.templatesDir = templatesDir;
  }

  /**
   * Render a template file with data
   */
  async render(templateName: string, data: TemplateData): Promise<string> {
    const templatePath = join(this.templatesDir, templateName);
    
    if (!(await pathExists(templatePath))) {
      throw new Error(`Template not found: ${templatePath}`);
    }

    const template = await readFile(templatePath, 'utf-8');
    return this.renderString(template, data);
  }

  /**
   * Render a template string with data
   */
  renderString(template: string, data: TemplateData): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = data[key];
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Render and save to file
   */
  async renderToFile(templateName: string, data: TemplateData, outputPath: string): Promise<void> {
    const rendered = await this.render(templateName, data);
    await ensureDir(join(outputPath, '..'));
    await writeFile(outputPath, rendered, 'utf-8');
  }

  /**
   * List available templates
   */
  async listTemplates(): Promise<string[]> {
    if (!(await pathExists(this.templatesDir))) {
      return [];
    }

    const entries = await readdir(this.templatesDir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile())
      .map(e => e.name);
  }
}

// Default template engine instance
export const templateEngine = new TemplateEngine(join(__dirname, '..', 'templates'));
