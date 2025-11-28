// 调试工具类 - 生产模式
export class Debug {
    private static enabled = true; // 启用调试模式
    private static verboseMode = true; // 启用详细日志

    // 根据首个字符串参数的前缀动态选择标签，例如消息以"[Notion]"或"[Feishu]"开头时，使用该标签
    private static pickTag(args: any[]): string {
        const fallback = 'Feishu';
        if (!args || args.length === 0) return fallback;
        const first = args[0];
        if (typeof first === 'string') {
            const m = first.match(/^\s*\[([A-Za-z0-9_]+)\]/);
            if (m && m[1]) return m[1];
        }
        return fallback;
    }

    static log(...args: any[]) {
        if (this.enabled) {
            const timestamp = new Date().toISOString().substring(11, 23);
            const tag = this.pickTag(args);
            console.log(`[${tag} ${timestamp}]`, ...args);
        }
    }

    static warn(...args: any[]) {
        if (this.enabled) {
            const timestamp = new Date().toISOString().substring(11, 23);
            const tag = this.pickTag(args);
            console.warn(`[${tag} ${timestamp}] ⚠️`, ...args);
        }
    }

    static error(...args: any[]) {
        if (this.enabled) {
            const timestamp = new Date().toISOString().substring(11, 23);
            const tag = this.pickTag(args);
            console.error(`[${tag} ${timestamp}] ❌`, ...args);
        }
    }

    static verbose(...args: any[]) {
        if (this.enabled && this.verboseMode) {
            const timestamp = new Date().toISOString().substring(11, 23);
            const tag = this.pickTag(args);
            console.log(`[${tag} ${timestamp}] 🔍`, ...args);
        }
    }

    static step(stepName: string, ...args: any[]) {
        if (this.enabled) {
            const timestamp = new Date().toISOString().substring(11, 23);
            const tag = this.pickTag(args);
            console.log(`[${tag} ${timestamp}] 📋 STEP: ${stepName}`, ...args);
        }
    }

    static api(method: string, url: string, data?: any) {
        if (this.enabled && this.verboseMode) {
            const timestamp = new Date().toISOString().substring(11, 23);
            const tag = this.pickTag([method]);
            console.log(`[${tag} ${timestamp}] 🌐 API: ${method} ${url}`, data ? data : '');
        }
    }

    static result(operation: string, success: boolean, data?: any) {
        if (this.enabled) {
            const timestamp = new Date().toISOString().substring(11, 23);
            const tag = this.pickTag([operation]);
            const icon = success ? '✅' : '❌';
            console.log(`[${tag} ${timestamp}] ${icon} ${operation}:`, data ? data : '');
        }
    }

    static enable() {
        this.enabled = true;
        console.log('[Feishu] 🔧 Debug logging enabled');
    }

    static disable() {
        this.enabled = false;
        console.log('[Feishu] 🔇 Debug logging disabled');
    }

    static enableVerbose() {
        this.verboseMode = true;
        console.log('[Feishu] 🔍 Verbose logging enabled');
    }

    static disableVerbose() {
        this.verboseMode = false;
        console.log('[Feishu] 🤫 Verbose logging disabled');
    }

    static isEnabled(): boolean {
        return this.enabled;
    }

    static isVerbose(): boolean {
        return this.verboseMode;
    }

    static getStatus(): string {
        return `Debug: ${this.enabled ? 'ON' : 'OFF'}, Verbose: ${this.verboseMode ? 'ON' : 'OFF'}`;
    }
}
