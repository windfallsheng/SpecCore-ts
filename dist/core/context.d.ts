export interface Context {
    currentIteration: string;
    currentTask: string;
    currentAssignee: string;
    lastUpdated: string;
    lastAction: string;
    lastIntent: string;
    interruptedAt: string;
    iterationStatus: string;
    pendingTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    blockedTasks: number;
    customAliases: Record<string, string>;
    history: ContextHistoryEntry[];
    hotfix?: HotfixEntry;
}
export interface HotfixEntry {
    taskId: string;
    startedAt: string;
    graceEndsAt: string;
    mustSyncBy: string;
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
/** 标记任务为 hotfix，宽限期 30 分钟 */
export declare function startHotfix(taskId: string): Promise<void>;
/** 清除 hotfix 标记 */
export declare function clearHotfix(): Promise<void>;
/** 获取当前 hotfix 状态（给 validate/progress 用） */
export declare function getHotfixStatus(): Promise<{
    inHotfix: boolean;
    graceExpired: boolean;
    mandatoryExpired: boolean;
    taskId: string;
} | null>;
//# sourceMappingURL=context.d.ts.map