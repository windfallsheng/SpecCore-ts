export interface ConfigOptions {
    get?: string;
    set?: string;
    reset?: boolean;
    rule?: string;
    tech?: string;
}
/**
 * Install Git hooks (pre-commit + pre-push)
 */
export declare function installHooks(): void;
export declare function configCommand(options: ConfigOptions): Promise<void>;
//# sourceMappingURL=config.d.ts.map