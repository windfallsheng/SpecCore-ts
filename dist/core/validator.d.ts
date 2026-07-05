export interface ValidationError {
    file: string;
    issue: string;
    severity: 'error' | 'warning';
    fixable?: boolean;
}
export interface ValidationResult {
    errors: ValidationError[];
    warnings: ValidationError[];
    passRate: number;
    totalChecks: number;
    taskResults: Record<string, TaskValidationResult>;
}
export interface TaskValidationResult {
    taskId: string;
    errors: ValidationError[];
    warnings: ValidationError[];
    passRate: number;
}
export declare function validateProject(iteration?: string, taskId?: string, options?: {
    fix?: boolean;
    strict?: boolean;
}): Promise<ValidationResult>;
export declare function formatValidationResult(result: ValidationResult, format: 'text' | 'json'): string;
export declare function autoFix(result: ValidationResult): Promise<number>;
//# sourceMappingURL=validator.d.ts.map