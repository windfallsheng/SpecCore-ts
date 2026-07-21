export interface ConfigOptions {
    get?: string;
    set?: string;
    reset?: boolean;
    rule?: string;
    tech?: string;
}
export declare function configCommand(options: ConfigOptions): Promise<void>;
//# sourceMappingURL=config.d.ts.map