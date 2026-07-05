export interface ArchiveOptions {
    task?: string;
    all?: boolean;
    iteration?: string;
    list?: boolean;
    restore?: string;
    force?: boolean;
}
export declare function archiveCommand(options: ArchiveOptions): Promise<void>;
//# sourceMappingURL=archive.d.ts.map