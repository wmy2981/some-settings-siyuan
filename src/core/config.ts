/**
 * 每个功能的配置持久化。
 *
 * 存储路径由宿主决定：/data/storage/petal/<插件名>/<storageName>。
 * 一个功能一个文件，这样「重置某个功能」不会影响其他功能，
 * 也符合四态里「是否加载已有配置」的粒度。
 *
 * 所有读写都走 plugin.loadData / saveData / removeData，
 * 绝不直接调用 fs 或 Node API（官方开发规范要求）。
 *
 * 导出 / 导入 / 清除这三个动作按**目录里的文件**来，不按代码里注册的功能来：
 * 四态、前端适配、是否已退役只决定功能加不加载，退役的、甚至已经从插件里删掉的
 * 功能留下的配置文件同样是本插件的配置（见 core/storage.ts）。
 */
import type {Plugin} from "siyuan";
import {featureById} from "./registry";
import {
    listStoredFiles,
    readStoredFile,
    removeStoredFile,
    writeStoredFile,
} from "./storage";
import type {
    FeatureConfig,
    FeatureDefinition,
    SettingField,
} from "./types";

/** 配置文件名前缀：一个功能一个文件。 */
const FILE_PREFIX = "feature-";

/** 一个功能对应一个存储文件名。只用小写字母、数字与连字符，天然安全。 */
export const storageNameOf = (id: string): string => `${FILE_PREFIX}${id}`;

/** 功能 id 的合法字符集，与功能文件夹名的规则一致。 */
const ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * 目录里的文件名 → 功能 id；不是本插件的配置文件时返回 undefined。
 *
 * 宿主写盘时不加扩展名，`.json` 只是容忍历史上或别处留下的写法。
 */
const idOfStoredFile = (fileName: string): string | undefined => {
    const base = fileName.endsWith(".json") ? fileName.slice(0, -".json".length) : fileName;
    const id = base.startsWith(FILE_PREFIX) ? base.slice(FILE_PREFIX.length) : "";
    return ID_PATTERN.test(id) ? id : undefined;
};

const PREFIX = "[some-settings-siyuan]";

/** 给错误挂上可读的问题清单，供面板一次性提示。 */
export const attachProblems = (problems: string[]): Error & {problems: string[];} => {
    const error = new Error(problems.join("; ")) as Error & {problems: string[];};
    error.problems = problems;
    return error;
};

/**
 * 比较写入值与读回值，返回差异描述；一致时返回空串。
 * 只比较写入时真正用到的键，避免宿主额外字段造成误报；
 * 值按 JSON 比较 —— 导入不认识的配置时值可能带嵌套对象，`!==` 会把它们全判成不一致。
 */
export const describeMismatch = (written: FeatureConfig, readBack: unknown): string => {
    if (typeof readBack !== "object" || readBack === null || Array.isArray(readBack)) {
        return `read back is not an object (${JSON.stringify(readBack)})`;
    }
    const actual = readBack as Record<string, unknown>;
    const diffs = Object.keys(written).filter((key) => JSON.stringify(actual[key]) !== JSON.stringify(written[key]))
        .map((key) => `${key}: wrote ${JSON.stringify(written[key])} / read back ${JSON.stringify(actual[key])}`);
    return diffs.join("; ");
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
            // 动作行只负责触发一次行为、说明块只负责显示文字，都没有可持久化的取值，
            // 配置里不该出现它们的 key
            if (field.kind === "button" || field.kind === "note") {
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
                        warn?.(
                            `"${field.key}" should be boolean, got ${
                                JSON.stringify(value)
                            }, falling back to the default`,
                        );
                        result[field.key] = field.default;
                    }
                    break;
                case "text":
                    if (typeof value === "string") {
                        result[field.key] = value;
                    } else {
                        warn?.(
                            `"${field.key}" should be string, got ${
                                JSON.stringify(value)
                            }, falling back to the default`,
                        );
                        result[field.key] = field.default;
                    }
                    break;
                case "number":
                    if (typeof value === "number" && Number.isFinite(value)) {
                        result[field.key] = clampNumber(value, field);
                    } else {
                        warn?.(
                            `"${field.key}" should be number, got ${
                                JSON.stringify(value)
                            }, falling back to the default`,
                        );
                        result[field.key] = field.default;
                    }
                    break;
                case "select":
                    // 静态 options 走白名单；optionsProvider 的候选集只有运行时才知道，
                    // 这里无法校验，交给功能自己在使用处兜底。
                    if (
                        typeof value === "string" &&
                        (!field.options || field.options.some((option) => option.value === value))
                    ) {
                        result[field.key] = value;
                    } else {
                        warn?.(
                            `"${field.key}" should be one of ${
                                (field.options || []).map((option) => option.value).join("/")
                            }, got ${JSON.stringify(value)}, falling back to the default`,
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
            console.warn(`[some-settings-siyuan] failed to read ${storageNameOf(id)}, using the default`, error);
        }
        // 文件不存在时宿主 resolve 空串
        if (typeof stored === "string") {
            stored = null;
        }
        const warnings: string[] = [];
        entry.config = normalizeConfig(entry.definition.settings, stored, (message) => warnings.push(message));
        if (warnings.length > 0) {
            console.warn(`[some-settings-siyuan] ${storageNameOf(id)} has ${warnings.length} field problem(s):`);
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
     * 目录里此刻有哪些配置文件。
     *
     * 这是导出 / 导入 / 清除的共同入口：目标集合由磁盘决定，不受四态、前端适配与
     * 是否退役影响。名字不合规的文件（不是本插件的配置）只告警，绝不按猜测去动它。
     * 列不出目录时抛出，绝不退化成「一个配置都没有」。
     */
    private async storedFiles(): Promise<{id: string; storageName: string;}[]> {
        const files: {id: string; storageName: string;}[] = [];
        for (const storageName of await listStoredFiles(this.plugin)) {
            const id = idOfStoredFile(storageName);
            if (typeof id === "undefined") {
                console.warn(`${PREFIX} ${storageName} is not a feature configuration file, leaving it alone`);
                continue;
            }
            files.push({id, storageName});
        }
        return files;
    }

    /**
     * 找某个 id 的功能声明：先在已注册的功能里找，再退回整个注册表。
     *
     * 注册表里有、本宿主没注册的功能（前端不适用、已被思源原生实现取代）同样有 schema，
     * 导入时按它归一化，才不至于因为「这台机器不加载这个功能」就绕过校验。
     */
    private definitionOfAny(id: string): FeatureDefinition | undefined {
        return this.entries.get(id)?.definition || featureById(id);
    }

    /**
     * 逐个写文件并读回校验。
     *
     * 写完立刻读回的理由：宿主 saveData 的 Promise 在文件真的落盘前就可能 resolve，
     * code 非 0 时也照样兑现（宿主的消息处理只拦负数 code），光看「没报错」不足以说明存住了。
     * 读回不一致就抛出，让面板保持打开、把真实原因暴露出来，
     * 而不是等用户下次打开时发现又变回默认值。
     */
    private async writeFiles(files: {storageName: string; value: FeatureConfig;}[]): Promise<void> {
        const failed: string[] = [];
        for (const {storageName, value} of files) {
            console.log(`${PREFIX} writing ${storageName}`, value);
            const status = await writeStoredFile(this.plugin, storageName, value);
            if (!status.ok) {
                console.error(`${PREFIX} ${storageName} was rejected by the kernel: ${status.detail}`);
                failed.push(`${storageName}: ${status.detail}`);
                continue;
            }
            const readBack = await readStoredFile(this.plugin, storageName);
            const detail = describeMismatch(value, readBack);
            if (detail) {
                console.error(`${PREFIX} ${storageName} read back mismatch after write: ${detail}`, {
                    written: value,
                    readBack,
                });
                failed.push(`${storageName}：${detail}`);
            } else {
                console.log(`${PREFIX} ${storageName} written and read back consistently`);
            }
        }
        if (failed.length > 0) {
            throw attachProblems(failed);
        }
    }

    /**
     * 批量保存（设置面板点「保存」时调用）。
     *
     * 先按每个功能的 schema 归一化并把问题收齐，一旦有问题就整体不写，
     * 让用户能一次性看到全部问题；校验通过才逐个落盘，最后统一通知订阅者。
     */
    async saveMany(drafts: Record<string, FeatureConfig>): Promise<void> {
        const prepared: {id: string; config: FeatureConfig;}[] = [];
        const problems: string[] = [];
        Object.keys(drafts).forEach((id) => {
            const entry = this.entries.get(id);
            if (!entry) {
                problems.push(`${id}: no config store entry for this feature`);
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

        prepared.forEach(({id, config}) => {
            const entry = this.entries.get(id);
            if (entry) {
                entry.config = config;
            }
        });
        await this.writeFiles(prepared.map(({id, config}) => ({storageName: storageNameOf(id), value: config})));
        prepared.forEach(({id}) => this.notify(id));
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

    /**
     * 清除存储目录下的全部配置文件（关于分类的「清除本插件配置」动作行使用）。
     *
     * 清的是目录里的文件，不是代码里注册的功能：四态、前端适配、是否退役都只决定功能
     * 加不加载，退役的、甚至已经从插件里删掉的功能留下的配置文件同样要清掉，
     * 否则它们会一直躺在工作区里，谁也看不见、谁也删不掉。
     *
     * 删成功的文件对应把内存态回落默认值并通知订阅者，所以磁盘与内存在这一步就一致了；
     * 有任何一个删不掉就把它们收集起来一次性抛出，让用户看见具体是哪个文件。
     */
    async clearAll(): Promise<void> {
        const failed: string[] = [];
        const cleared: string[] = [];
        for (const {id, storageName} of await this.storedFiles()) {
            const status = await removeStoredFile(this.plugin, storageName);
            if (status.ok) {
                cleared.push(id);
                continue;
            }
            console.warn(`${PREFIX} failed to clear ${storageName}: ${status.detail}`);
            failed.push(`${storageName}: ${status.detail}`);
        }
        cleared.forEach((id) => {
            const entry = this.entries.get(id);
            if (!entry) {
                return;
            }
            entry.config = defaultConfig(entry.definition.settings);
            this.notify(id);
        });
        if (failed.length > 0) {
            throw attachProblems(failed);
        }
    }

    /**
     * 导出存储目录下的全部配置，键是功能 id（供关于类功能使用）。
     *
     * 读的是文件本身，不是内存里那份配置：四态 0 / 3 的功能不读盘（内存里是默认值），
     * 当前客户端不加载的功能也根本没有内存态 —— 文件才是「配置到底是什么」的唯一依据。
     */
    async exportAll(): Promise<Record<string, FeatureConfig>> {
        const result: Record<string, FeatureConfig> = {};
        for (const {id, storageName} of await this.storedFiles()) {
            const stored = await readStoredFile(this.plugin, storageName);
            if (!isPlainObject(stored)) {
                console.warn(`${PREFIX} ${storageName} does not hold an object, skipping it in the export`);
                continue;
            }
            result[id] = stored;
        }
        return result;
    }

    /**
     * 把一批配置写回各自的配置文件（导入用）。
     *
     * 认识的 id（已注册的、以及注册表里有但本宿主不加载的）按 schema 归一化后写入，
     * 与面板点「保存」同一条路，非法值会被报出来而不是静默落盘；
     * 不认识的 id —— 已经被删掉的功能留下的、或者别的插件版本才有的功能 ——
     * 原样写回它自己的文件，否则一次「导出 → 清除 → 导入」就会把这些配置丢掉。
     * id 不合规（可能借此把文件写到目录外）或值不是对象的条目一律不写，交回调用方汇报。
     */
    async importMany(input: Record<string, unknown>): Promise<{applied: string[]; skipped: string[];}> {
        const applied: string[] = [];
        const skipped: string[] = [];
        const known: {id: string; value: FeatureConfig;}[] = [];
        const foreign: {id: string; value: FeatureConfig;}[] = [];
        Object.keys(input).forEach((id) => {
            if (!ID_PATTERN.test(id) || !isPlainObject(input[id])) {
                skipped.push(id);
                return;
            }
            (this.definitionOfAny(id) ? known : foreign).push({id, value: input[id] as FeatureConfig});
            applied.push(id);
        });

        // 认识的 id 先整体归一化：有问题就整体不写，让用户一次性看到全部问题
        const prepared: {id: string; value: FeatureConfig;}[] = [];
        const problems: string[] = [];
        known.forEach(({id, value}) => {
            const definition = this.definitionOfAny(id);
            if (!definition) {
                return;
            }
            const warnings: string[] = [];
            const config = normalizeConfig(definition.settings, value, (message) => warnings.push(message));
            warnings.forEach((warning) => problems.push(`${id}: ${warning}`));
            prepared.push({id, value: config});
        });
        if (problems.length > 0) {
            throw attachProblems(problems);
        }

        const files = [...prepared, ...foreign].map(({id, value}) => ({storageName: storageNameOf(id), value}));
        await this.writeFiles(files);
        // 内存态跟着磁盘走，导入的配置立刻生效，不必等页面重载
        prepared.forEach(({id, value}) => {
            const entry = this.entries.get(id);
            if (entry) {
                entry.config = value;
            }
            this.notify(id);
        });
        return {applied, skipped};
    }

    /** 插件卸载时收尾：清掉订阅者，不再需要延迟写盘（保存已改为显式提交）。 */
    dispose(): void {
        this.listeners.clear();
    }
}
