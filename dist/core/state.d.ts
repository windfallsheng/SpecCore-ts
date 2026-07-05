export interface TaskState {
    id: string;
    name: string;
    type: string;
    status: 'pending' | 'in_progress' | 'completed' | 'archived';
    assignee: string;
    dependencies: string[];
    priority: 'high' | 'medium' | 'low';
    progress: number;
    startDate?: string;
    endDate?: string;
}
export interface IterationState {
    name: string;
    status: string;
    startDate: string;
    endDate: string;
    tasks: TaskState[];
    completionRate: number;
}
export declare function readProjectGraph(iteration: string): Promise<IterationState>;
export declare function scanTasks(iteration: string): Promise<TaskState[]>;
export declare function calculateCompletionRate(tasks: TaskState[]): number;
export declare function buildDependencyGraph(tasks: TaskState[]): Map<string, string[]>;
export declare function topologicalSort(tasks: TaskState[]): TaskState[];
//# sourceMappingURL=state.d.ts.map