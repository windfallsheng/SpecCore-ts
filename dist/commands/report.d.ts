export interface ReportOptions {
    iteration?: string;
    format?: string;
    output?: string;
    team?: boolean;
    risk?: boolean;
    trend?: boolean;
}
export declare function reportCommand(options: ReportOptions): Promise<void>;
//# sourceMappingURL=report.d.ts.map