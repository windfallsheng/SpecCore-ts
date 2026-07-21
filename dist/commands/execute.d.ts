export interface ExecuteOptions {
    all?: boolean;
    assignee?: string;
    task?: string;
    type?: string;
    priority?: string;
    status?: string;
    platform?: string;
    backend?: boolean;
    frontend?: boolean;
    interactive?: boolean;
    dryRun?: boolean;
    resume?: boolean;
    parallel?: string;
    iteration?: string;
    force?: boolean;
    batchSize?: string;
    hotfix?: boolean;
    strict?: boolean;
    base?: string;
}
export declare function executeCommand(options: ExecuteOptions): Promise<void>;
//# sourceMappingURL=execute.d.ts.map