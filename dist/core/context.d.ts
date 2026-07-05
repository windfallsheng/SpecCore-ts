export interface Context {
    currentIteration: string;
    currentTask: string;
    currentAssignee: string;
    lastUpdated: string;
    history: ContextHistoryEntry[];
}
export interface ContextHistoryEntry {
    command: string;
    timestamp: string;
    iteration?: string;
    task?: string;
}
export declare function loadContext(): Promise<Context>;
export declare function saveContext(context: Context): Promise<void>;
export declare function updateContext(partial: Partial<Context>): Promise<void>;
export declare function recordHistory(command: string, iteration?: string, task?: string): Promise<void>;
export declare function detectActiveIteration(): Promise<string>;
export declare function detectCurrentAssignee(): Promise<string>;
export declare function getDefaultIteration(iteration?: string): Promise<string>;
export declare function getDefaultAssignee(assignee?: string): Promise<string>;
//# sourceMappingURL=context.d.ts.map