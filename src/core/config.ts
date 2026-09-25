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

const DEBOUNCE_MS = 300;

/** 一个功能对应一个存储文件名。只用小写字母、数字与连字符，天然安全。 */
export const storageNameOf = (id: string): string => `feature-${id}`;

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
            if (field.kind === "group") {
                visit(field.children);
                return;
            }
            if (field.kind === "action") {
                return;
            }
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
                    if (typeof value === "string" && field.options.some((option) => option.value === value)) {
                        result[field.key] = value;
                    } else {
                        warn?.(
                            `"${field.key}" 应为 ${field.options.map((option) => option.value).join("/")} 之一，收到 ${
                                JSON.stringify(value)
                            }，已回落默认值`,
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
    private readonly timers = new Map<string, number>();
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

    /** 立即写盘。loadEnabled 为假时不写，避免覆盖磁盘上保留的旧配置。 */
    async saveNow(id: string): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry) {
            return;
        }
        const timer = this.timers.get(id);
        if (typeof timer === "number") {
            window.clearTimeout(timer);
            this.timers.delete(id);
        }
        if (!entry.loadEnabled) {
            return;
        }
        await this.plugin.saveData(storageNameOf(id), entry.config);
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

    /** 合并 patch 但不立即落盘（节流），用于连续拨动的开关。 */
    patchDeferred(id: string, patch: FeatureConfig): void {
        const entry = this.entries.get(id);
        if (!entry) {
            return;
        }
        entry.config = {...entry.config, ...patch};
        this.notify(id);
        const timer = this.timers.get(id);
        if (typeof timer === "number") {
            window.clearTimeout(timer);
        }
        this.timers.set(
            id,
            window.setTimeout(() => {
                this.timers.delete(id);
                this.saveNow(id).catch((error) => {
                    console.error(`[some-settings-siyuan] 保存 ${storageNameOf(id)} 失败`, error);
                });
            }, DEBOUNCE_MS),
        );
    }

    /** 删除磁盘文件并回落默认值（「重置本功能」）。 */
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

    /** 插件卸载时清掉未落盘的定时器。 */
    dispose(): void {
        this.timers.forEach((timer) => window.clearTimeout(timer));
        this.timers.clear();
        this.listeners.clear();
    }
}
