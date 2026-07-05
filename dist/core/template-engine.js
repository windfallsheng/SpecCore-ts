"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templateEngine = exports.TemplateEngine = void 0;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
/**
 * Simple template engine that replaces {{key}} placeholders
 */
class TemplateEngine {
    constructor(templatesDir) {
        this.templatesDir = templatesDir;
    }
    /**
     * Render a template file with data
     */
    async render(templateName, data) {
        const templatePath = (0, path_1.join)(this.templatesDir, templateName);
        if (!(await (0, fs_extra_1.pathExists)(templatePath))) {
            throw new Error(`Template not found: ${templatePath}`);
        }
        const template = await (0, fs_extra_1.readFile)(templatePath, 'utf-8');
        return this.renderString(template, data);
    }
    /**
     * Render a template string with data
     */
    renderString(template, data) {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            const value = data[key];
            return value !== undefined ? String(value) : match;
        });
    }
    /**
     * Render and save to file
     */
    async renderToFile(templateName, data, outputPath) {
        const rendered = await this.render(templateName, data);
        await (0, fs_extra_1.ensureDir)((0, path_1.join)(outputPath, '..'));
        await (0, fs_extra_1.writeFile)(outputPath, rendered, 'utf-8');
    }
    /**
     * List available templates
     */
    async listTemplates() {
        if (!(await (0, fs_extra_1.pathExists)(this.templatesDir))) {
            return [];
        }
        const entries = await (0, fs_extra_1.readdir)(this.templatesDir, { withFileTypes: true });
        return entries
            .filter(e => e.isFile())
            .map(e => e.name);
    }
}
exports.TemplateEngine = TemplateEngine;
// Default template engine instance
exports.templateEngine = new TemplateEngine((0, path_1.join)(__dirname, '..', 'templates'));
//# sourceMappingURL=template-engine.js.map