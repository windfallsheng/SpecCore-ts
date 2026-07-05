export interface TemplateData {
    [key: string]: string | number | boolean;
}
/**
 * Simple template engine that replaces {{key}} placeholders
 */
export declare class TemplateEngine {
    private templatesDir;
    constructor(templatesDir: string);
    /**
     * Render a template file with data
     */
    render(templateName: string, data: TemplateData): Promise<string>;
    /**
     * Render a template string with data
     */
    renderString(template: string, data: TemplateData): string;
    /**
     * Render and save to file
     */
    renderToFile(templateName: string, data: TemplateData, outputPath: string): Promise<void>;
    /**
     * List available templates
     */
    listTemplates(): Promise<string[]>;
}
export declare const templateEngine: TemplateEngine;
//# sourceMappingURL=template-engine.d.ts.map