export interface PlanOptions {
    iteration?: string;
    team?: string;
    assign?: string;
    type?: string;
    priority?: string;
    mode?: string;
    dryRun?: boolean;
    interactive?: boolean;
    list?: boolean;
    show?: string;
    delete?: string;
    cancel?: string;
}
export declare function planCommand(options: PlanOptions): Promise<void>;
//# sourceMappingURL=plan.d.ts.map