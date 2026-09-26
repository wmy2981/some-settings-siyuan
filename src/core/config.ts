/**
 * 每个功能的配置持久化。
 *
 * 存储路径由宿主决定：/data/storage/petal/<插件名>/<storageName>.json。
 * 一个功能一个文件，这样「重置某个功能」不会影响其他功能，
 * 也符合四态里「是否加载已有配置」的粒度。
 *
 * 所有读写都走 plugin.loadData / saveData / removeData，
 * 绝不直接调用 fs 或 Node API（官方开发规范要求）。
 */
import type {Plugin} from "siyuan";
import type {
    FeatureConfig,
    FeatureDefinition,
    SettingField,
} from "./types";

/** 一个功能对应一个存储文件名。只用小写字母、数字与连字符，天然安全。 */
export const storageNameOf = (id: string): string => `feature-${id}`;

const PREFIX = "[some-settings-siyuan]";

/** 给错误挂上可读的问题清单，供面板一次性提示。 */
export const attachProblems = (problems: string[]): Error & {problems: string[];} => {
    const error = new Error(problems.join("；")) as Error & {problems: string[];};
    error.problems = problems;
    return error;
};

/**
 * 比较写入值与读回值，返回差异描述；一致时返回空串。
 * 只比较写入时真正用到的键，避免宿主额外字段造成误报。
 */
export const describeMismatch = (written: FeatureConfig, readBack: unknown): string => {
    if (typeof readBack !== "object" || readBack === null || Array.isArray(readBack)) {
        return `读回的不是对象（${JSON.stringify(readBack)}）`;
    }
    const actual = readBack as Record<string, unknown>;
    const diffs = Object.keys(written).filter((key) => actual[key] !== written[key]).map((key) =>
        `${key}: 写入 ${JSON.stringify(written[key])} / 读回 ${JSON.stringify(actual[key])}`
    );
    return diffs.join("；");
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const clampNumber = (value: number, field: Extract<SettingField, {kind: "number";}>): number => {
    let next = value;
    if (typeof field.min === "number" && next < field.min) {
        next = field.min;
    }
    if (typeof field.max === "number" && next > field.max) {
        next = field.max;
    }
    return next;
};

/** 根据 schema 把任意输入归一化成合法配置，非法字段回落默认值。 */
export const normalizeConfig = (
    settings: SettingField[],
    input: unknown,
    warn?: (message: string) => void,
): FeatureConfig => {
    const source: Record<string, unknown> = isPlainObject(input) ? input : {};
    const result: FeatureConfig = {};

    const visit = (fields: SettingField[]) => {
        fields.forEach((field) => {
            const value = source[field.key];
            if (typeof value === "undefined") {
                result[field.key] = field.default;
                return;
            }
            switch (field.kind) {
                case "switch":
                    if (typeof value === "boolean") {
                        result[field.key] = value;
                    } else {
                        warn?.(`"${field.key}" 应为 boolean，收到 ${JSON.stringify(value)}，已回落默认值`);
                        result[field.key] = field.default;
                    }
                    break;
                case "text":
                    if (typeof value === "string") {
                        result[field.key] = value;
                    } else {
                        warn?.(`"${field.key}" 应为 string，收到 ${JSON.stringify(value)}，已回落默认值`);
                        result[field.key] = field.default;
                    }
                    break;
                case "number":
                    if (typeof value === "number" && Number.isFinite(value)) {
                        result[field.key] = clampNumber(value, field);
                    } else {
                        warn?.(`"${field.key}" 应为 number，收到 ${JSON.stringify(value)}，已回落默认值`);
                        result[field.key] = field.default;
                    }
                    break;
                case "select":
                    // 静态 options 走白名单；optionsProvider 的候选集只有运行时才知道，
                    // 这里无法校验，交给功能自己在使用处兜底。
                    if (typeof value === "string" && (!field.options || field.options.some((option) => option.value === value))) {
                        result[field.key] = value;
                    } else {
                        warn?.(
                            `"${field.key}" 应为 ${
                                (field.options || []).map((option) => option.value).join("/")
                            } 之一，收到 ${JSON.stringify(value)}，已回落默认值`,
                        );
                        result[field.key] = field.default;
                    }
                    break;
                default:
                    break;
            }
        });
    };

    visit(settings);
    return result;
};

/** 只要 schema 默认值，不读盘。四态中的 0 与 3 走这条路径。 */
export const defaultConfig = (settings: SettingField[]): FeatureConfig => normalizeConfig(settings, {});

interface Entry {
    definition: FeatureDefinition;
    loadEnabled: boolean;
    config: FeatureConfig;
}

export class ConfigStore {
    private readonly plugin: Plugin;
    private readonly entries = new Map<string, Entry>();
    private readonly listeners = new Map<string, Set<() => void>>();

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    /** 用 schema 默认值建立内存态；loadEnabled 为真时才真正读盘。 */
    async register(definition: FeatureDefinition, loadEnabled: boolean): Promise<FeatureConfig> {
        const entry: Entry = {definition, loadEnabled, config: defaultConfig(definition.settings)};
        this.entries.set(definition.id, entry);
        if (loadEnabled) {
            await this.reload(definition.id);
        } else {
            // 上游 loadData 会把结果写进 plugin.data，残留会在会话内被误用，这里主动清掉
            delete (this.plugin as unknown as {data: Record<string, unknown>;}).data[storageNameOf(definition.id)];
        }
        return entry.config;
    }

    private async reload(id: string): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry || !entry.loadEnabled) {
            return;
        }
        let stored: unknown = null;
        try {
            stored = await this.plugin.loadData(storageNameOf(id));
        } catch (error) {
            console.warn(`[some-settings-siyuan] 读取 ${storageNameOf(id)} 失败，使用默认值`, error);
        }
        // 文件不存在时宿主 resolve 空串
        if (typeof stored === "string") {
            stored = null;
        }
        const warnings: string[] = [];
        entry.config = normalizeConfig(entry.definition.settings, stored, (message) => warnings.push(message));
        if (warnings.length > 0) {
            console.warn(`[some-settings-siyuan] ${storageNameOf(id)} 存在 ${warnings.length} 个字段问题：`);
            warnings.forEach((warning) => console.warn(`[some-settings-siyuan] - ${warning}`));
        }
    }

    get(id: string): FeatureConfig {
        return this.entries.get(id)?.config || {};
    }

    definitionOf(id: string): FeatureDefinition | undefined {
        return this.entries.get(id)?.definition;
    }

    /** 订阅配置变化，返回取消订阅函数。 */
    subscribe(id: string, listener: () => void): () => void {
        const set = this.listeners.get(id) || new Set<() => void>();
        set.add(listener);
        this.listeners.set(id, set);
        return () => set.delete(listener);
    }

    private notify(id: string): void {
        this.listeners.get(id)?.forEach((listener) => listener());
    }

    /**
     * 立即写盘。
     *
     * 注意：即使是四态里「不加载已有配置」的 0 / 3，也允许在用户显式保存后写盘——
     * 「不加载」约束的是读取，不是让用户的修改凭空消失。
     */
    async saveNow(id: string): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry) {
            return;
        }
        await this.plugin.saveData(storageNameOf(id), entry.config);
    }

    /**
     * 批量保存（设置面板点「保存」时调用）。
     *
     * 先按每个功能的 schema 归一化并把问题收齐，一旦有问题就整体不写，
     * 让用户能一次性看到全部问题；校验通过才逐个落盘，最后统一通知订阅者。
     *
     * 每个文件写完后立刻读回校验：宿主 saveData 的 Promise 在文件真的落盘前就可能
     * resolve，光看「没报错」不足以说明存住了。读回不一致就抛出，让面板保持打开、
     * 把真实原因暴露出来，而不是等用户下次打开时发现又变回默认值。
     */
    async saveMany(drafts: Record<string, FeatureConfig>): Promise<void> {
        const prepared: {id: string; config: FeatureConfig;}[] = [];
        const problems: string[] = [];
        Object.keys(drafts).forEach((id) => {
            const entry = this.entries.get(id);
            if (!entry) {
                problems.push(`${id}: 该功能没有注册到配置存储`);
                return;
            }
            const warnings: string[] = [];
            const config = normalizeConfig(entry.definition.settings, drafts[id], (message) => warnings.push(message));
            warnings.forEach((warning) => problems.push(`${id}: ${warning}`));
            prepared.push({id, config});
        });
        if (problems.length > 0) {
            throw attachProblems(problems);
        }

        const mismatched: string[] = [];
        for (const {id, config} of prepared) {
            const entry = this.entries.get(id);
            if (!entry) {
                continue;
            }
            const storageName = storageNameOf(id);
            console.log(`${PREFIX} 写入 ${storageName}`, config);
            await this.plugin.saveData(storageName, config);
            entry.config = config;

            const readBack = await this.readBack(storageName);
            const detail = describeMismatch(config, readBack);
            if (detail) {
                console.error(`${PREFIX} ${storageName} 写入后读回不一致：${detail}`, {written: config, readBack});
                mismatched.push(`${storageName}：${detail}`);
            } else {
                console.log(`${PREFIX} ${storageName} 写入并读回一致`);
            }
        }
        if (mismatched.length > 0) {
            throw attachProblems(mismatched);
        }
        prepared.forEach(({id}) => this.notify(id));
    }

    /** 读回磁盘上的文件内容；文件不存在时宿主 resolve 空串，这里归一成 null。 */
    private async readBack(storageName: string): Promise<unknown> {
        try {
            const stored = await this.plugin.loadData(storageName);
            return typeof stored === "string" && stored === "" ? null : stored;
        } catch (error) {
            console.warn(`${PREFIX} 读回 ${storageName} 失败`, error);
            return null;
        }
    }

    /** 合并 patch 后落盘，并通知订阅者。写失败时抛出，由调用方回滚 UI。 */
    async patch(id: string, patch: FeatureConfig): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry) {
            return;
        }
        const warnings: string[] = [];
        entry.config = normalizeConfig(
            entry.definition.settings,
            {...entry.config, ...patch},
            (message) => warnings.push(message),
        );
        warnings.forEach((warning) => console.warn(`[some-settings-siyuan] ${warning}`));
        await this.saveNow(id);
        this.notify(id);
    }

    /** 删除磁盘文件并回落默认值。 */
    async reset(id: string): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry) {
            return;
        }
        try {
            await this.plugin.removeData(storageNameOf(id));
        } catch (error) {
            console.warn(`[some-settings-siyuan] 删除 ${storageNameOf(id)} 失败`, error);
        }
        entry.config = defaultConfig(entry.definition.settings);
        this.notify(id);
    }

    /** 导出全部功能的当前配置（供开发类功能使用）。 */
    exportAll(): Record<string, FeatureConfig> {
        const result: Record<string, FeatureConfig> = {};
        this.entries.forEach((entry, id) => {
            result[id] = {...entry.config};
        });
        return result;
    }

    /** 插件卸载时收尾：清掉订阅者，不再需要延迟写盘（保存已改为显式提交）。 */
    dispose(): void {
        this.listeners.clear();
    }
}
