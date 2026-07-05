export interface PlanOptions {
    iteration?: string;
    team?: string;
    assign?: string;
    task?: string;
    type?: string;
    priority?: string;
    mode?: string;
    dryRun?: boolean;
}
export declare function planCommand(options: PlanOptions): Promise<void>;
//# sourceMappingURL=plan.d.ts.map