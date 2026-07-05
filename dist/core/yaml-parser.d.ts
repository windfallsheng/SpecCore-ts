export interface ParseResult {
    success: boolean;
    data?: any;
    error?: string;
}
/**
 * Parse a YAML file and return structured data
 */
export declare function parseYamlFile(filePath: string): Promise<ParseResult>;
/**
 * Validate API contract YAML structure
 */
export declare function validateApiContract(data: any): string[];
/**
 * Convert YAML to JSON string
 */
export declare function yamlToJson(data: any): string;
/**
 * Extract API endpoints from YAML content
 */
export declare function extractEndpoints(data: any): Array<{
    path: string;
    method: string;
}>;
//# sourceMappingURL=yaml-parser.d.ts.map