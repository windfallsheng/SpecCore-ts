export interface ProgressOptions {
    iteration?: string;
    assignee?: string;
    type?: string;
    task?: string;
    platform?: string;
    detail?: boolean;
    format?: string;
}
export declare function progressCommand(options: ProgressOptions): Promise<void>;
//# sourceMappingURL=progress.d.ts.map