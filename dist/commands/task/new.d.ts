export interface TaskNewOptions {
    name?: string;
    type?: string;
    id?: string;
    desc?: string;
    file?: string;
    sections?: string;
    backendOnly?: boolean;
    frontendOnly?: boolean;
    iteration?: string;
}
export declare function taskNewCommand(options: TaskNewOptions): Promise<void>;
//# sourceMappingURL=new.d.ts.map