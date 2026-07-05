/**
 * import - 多项目导入命令
 * 将存量项目导入到全量层（GLOBAL/PROJECTS/），填充全量需求和索引
 */
export interface ImportOptions {
    source?: string;
    path?: string;
    url?: string;
    iteration?: string;
    project?: string;
    type?: string;
    force?: boolean;
}
export declare function importCommand(options: ImportOptions): Promise<void>;
//# sourceMappingURL=import.d.ts.map