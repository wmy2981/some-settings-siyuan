/**
 * 每个功能的配置持久化。
 *
 * 存储路径由宿主决定：/data/storage/petal/<插件名>/<storageName>。
 * 一个功能一个文件，这样「重置某个功能」不会影响其他功能，
 * 也符合「一个功能一个开关」的粒度。
 *
 * 所有读写都走 plugin.loadData / saveData / removeData，
 * 绝不直接调用 fs 或 Node API（官方开发规范要求）。
 *
 * 导出 / 导入 / 清除这三个动作按**目录里的文件**来，不按代码里注册的功能来：
 * 声明里的 `enabled`、前端适配、版本区间只决定功能加不加载，退役的、甚至已经从插件里删掉的
 * 功能留下的配置文件同样是本插件的配置（见 core/storage.ts）。
 */
import type {Plugin} from "siyuan";
import {createLogger} from "./log";
import {featureById} from "./registry";
import {
    CONFIG_IO_CONCURRENCY,
    listStoredFiles,
    mapLimit,
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

const log = createLogger("core.config");

/** 给错误挂上可读的问题清单，供面板一次性提示。 */
export const attachProblems = (problems: string[]): Error & {problems: string[];} => {
    const error = new Error(problems.join("; ")) as Error & {problems: string[];};
    error.problems = problems;
    return error;
};

/**
 * 两份配置在 schema 意义上是否相同。
 *
 * 值按 JSON 比较：导入的配置可能带嵌套对象，`!==` 会把它们全判成不同。
 * 设置面板靠它在写盘前挡掉「下拉重选同一项」「开关重设同一状态」这类没有改动的改动。
 */
export const sameConfig = (left: FeatureConfig, right: FeatureConfig): boolean => {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
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
                case "textarea":
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

/** 只要 schema 默认值，不读盘。*/
export const defaultConfig = (settings: SettingField[]): FeatureConfig => normalizeConfig(settings, {});

interface Entry {
    definition: FeatureDefinition;
    config: FeatureConfig;
}

export class ConfigStore {
    private readonly plugin: Plugin;
    private readonly entries = new Map<string, Entry>();
    private readonly listeners = new Map<string, Set<() => void>>();
    private readonly patchQueues = new Map<string, Promise<void>>();
    /**
     * `prefetch()` 已经读回来的原始值，键是功能 id。
     *
     * 只影响「什么时候读」，`register()` 仍然按调用顺序应用，于是挂载顺序与日志顺序都不变。
     * 存的是**未兑现的 Promise**：某个文件读得慢 / 一直不返回时，只有它自己与排在它后面的
     * 功能会等，前面的功能照常挂载（先等全部读完再逐个注册会把一次慢读放大成整插件启动失败）。
     * 被 `register()` 取走的条目读完即删：预读只是一次性加速，不额外留一份可能过期的缓存；
     * 没被取走的在 `dispose()` 时清空。
     */
    private readonly prefetched = new Map<string, Promise<{stored?: unknown; error?: unknown;}>>();

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    /**
     * 并发预读一批功能的配置文件。
     *
     * 启动阶段每个功能各要一次 `loadData`，逐个 await 会把 N 次内核往返串起来
     * （实测 34 个功能、每次 2ms 时要 87ms）；这些文件互不依赖，可以先一起读回来，
     * 再由 `register()` 按注册表顺序逐个应用。读失败不抛：`register()` 里按老规矩
     * 记一条警告并回落默认值。
     */
    async prefetch(definitions: FeatureDefinition[]): Promise<void> {
        // 每条配置一个「先发出去的 Promise」：请求按 CONFIG_IO_CONCURRENCY 的并发度提前发出，
        // 但每条各自兑现，`register()` 只等自己那一条 —— 某个文件读得慢不会拖住别的功能。
        const pending = new Map<string, (read: {stored?: unknown; error?: unknown;}) => void>();
        definitions.forEach((definition) => {
            let resolve: (read: {stored?: unknown; error?: unknown;}) => void = () => undefined;
            const promise = new Promise<{stored?: unknown; error?: unknown;}>((done) => {
                resolve = done;
            });
            pending.set(definition.id, resolve);
            this.prefetched.set(definition.id, promise);
        });
        // 请求本身不等待：预读只是把读盘提前，真正的等待发生在各自 register() 里
        void mapLimit(definitions, CONFIG_IO_CONCURRENCY, async (definition) => {
            const done = pending.get(definition.id);
            try {
                done?.({stored: await this.plugin.loadData(storageNameOf(definition.id))});
            } catch (error) {
                done?.({error});
            }
        }).catch((error: unknown) => {
            // mapper 自己已经收敛了读盘异常，走到这里说明有意外抛出。把还没兑现的预读
            // 一律以同一个错误兑现，register() 才不会永久挂在一条没人会再 resolve 的 Promise 上。
            pending.forEach((done) => done({error}));
        });
    }

    /** 用 schema 默认值建立内存态，并读回磁盘上已有的配置。 */
    async register(definition: FeatureDefinition): Promise<FeatureConfig> {
        const entry: Entry = {definition, config: defaultConfig(definition.settings)};
        this.entries.set(definition.id, entry);
        await this.reload(definition.id);
        return entry.config;
    }

    private async reload(id: string): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry) {
            return;
        }
        let stored: unknown = null;
        const prefetched = this.prefetched.get(id);
        this.prefetched.delete(id);
        if (prefetched) {
            // 预读失败与现场读失败的处理完全一致：记一条警告，回落默认值
            const read = await prefetched;
            if ("error" in read) {
                log.warn(`cannot read ${storageNameOf(id)}; using the defaults`, read.error);
            } else {
                stored = read.stored;
            }
        } else {
            try {
                stored = await this.plugin.loadData(storageNameOf(id));
            } catch (error) {
                log.warn(`cannot read ${storageNameOf(id)}; using the defaults`, error);
            }
        }
        // 文件不存在时宿主 resolve 空串
        if (typeof stored === "string") {
            stored = null;
        }
        const warnings: string[] = [];
        entry.config = normalizeConfig(entry.definition.settings, stored, (message) => warnings.push(message));
        if (stored === null) {
            log.info(`${id}: no saved configuration, using the defaults`, entry.config);
        } else {
            log.info(`${id}: loaded`, entry.config);
        }
        if (warnings.length > 0) {
            log.warn(`${id}: ${warnings.length} field problem(s) in ${storageNameOf(id)}`);
            warnings.forEach((warning) => log.warn(`${id}: ${warning}`));
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
     * 目录里此刻有哪些配置文件。
     *
     * 这是导出 / 导入 / 清除的共同入口：目标集合由磁盘决定，不受声明里的 enabled、
     * 前端适配与版本区间影响。名字不合规的文件（不是本插件的配置）只告警，绝不按猜测去动它。
     * 列不出目录时抛出，绝不退化成「一个配置都没有」。
     */
    private async storedFiles(): Promise<{id: string; storageName: string;}[]> {
        const files: {id: string; storageName: string;}[] = [];
        for (const storageName of await listStoredFiles(this.plugin)) {
            const id = idOfStoredFile(storageName);
            if (typeof id === "undefined") {
                log.warn(`${storageName} is not a feature configuration file, leaving it alone`);
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
     * 读回不一致就抛出，让调用方把控件退回磁盘上的值、把真实原因暴露出来，
     * 而不是等用户下次打开时发现又变回默认值。
     */
    private async writeFiles(files: {storageName: string; value: FeatureConfig;}[]): Promise<void> {
        const failed: string[] = [];
        log.info(`writing ${files.length} configuration file(s)`);
        // 每个文件都是独立的「写 + 读回」，彼此没有先后关系，按有限并发一起跑到完成；
        // 结果按输入顺序回填，问题清单的顺序仍然与文件清单一致。
        const problems = await mapLimit(files, CONFIG_IO_CONCURRENCY, async ({storageName, value}) => {
            log.info(`writing ${storageName}`, value);
            const status = await writeStoredFile(this.plugin, storageName, value);
            if (!status.ok) {
                log.error(`${storageName} was rejected by the kernel: ${status.detail}`);
                return `${storageName}: ${status.detail}`;
            }
            const readBack = await readStoredFile(this.plugin, storageName);
            const detail = describeMismatch(value, readBack);
            if (detail) {
                log.error(`${storageName} read back mismatch after write: ${detail}`, {
                    written: value,
                    readBack,
                });
                return `${storageName}：${detail}`;
            }
            log.info(`${storageName} written and read back consistently`);
            return "";
        });
        problems.forEach((problem) => {
            if (problem) {
                failed.push(problem);
            }
        });
        if (failed.length > 0) {
            throw attachProblems(failed);
        }
    }

    /**
     * 合并 patch 后立即落盘，并通知订阅者 —— 设置面板的每一次控件改动都走这里。
     *
     * 顺序固定为「按 schema 归一化 → 合并内存态 → 写盘 → 读回校验 → 通知」：
     * - 与当前值相同的改动不写盘：下拉重选同一项、开关重设同一状态都算没改；
     * - 写盘失败或读回不一致时把内存态退回改动之前，再把问题抛给调用方 ——
     *   界面据此把控件改回磁盘上的值，不允许停在「看着存住了、其实没存」的状态。
     *
     * 同一功能的归一化、写入、读回与回滚按调用顺序串行执行：乱序完成会让旧值覆盖新值，
     * 失败回滚也可能把后来已经落盘的改动一起抹掉。失败只拒绝自己的调用，不能中断后续队列。
     */
    async patch(id: string, patch: FeatureConfig): Promise<void> {
        const previousQueue = this.patchQueues.get(id) || Promise.resolve();
        const queued = previousQueue.catch((): void => undefined).then(() => this.applyPatch(id, patch));
        this.patchQueues.set(id, queued);
        try {
            await queued;
        } finally {
            if (this.patchQueues.get(id) === queued) {
                this.patchQueues.delete(id);
            }
        }
    }

    private async applyPatch(id: string, patch: FeatureConfig): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry) {
            return;
        }
        const previous = entry.config;
        const warnings: string[] = [];
        const next = normalizeConfig(
            entry.definition.settings,
            {...previous, ...patch},
            (message) => warnings.push(message),
        );
        warnings.forEach((warning) => log.warn(`${id}: ${warning}`));
        if (sameConfig(previous, next)) {
            log.info(`${id}: patch changes nothing, skipping the write`);
            return;
        }
        log.info(`${id}: applying patch`, patch);
        entry.config = next;
        try {
            await this.writeFiles([{storageName: storageNameOf(id), value: next}]);
        } catch (error) {
            // 只在本功能的内存态仍是这次写入的值时才回退：期间若已有更晚的改动落盘，
            // 用旧值覆盖会把那次改动一起抹掉。
            if (entry.config === next) {
                entry.config = previous;
            }
            throw error;
        }
        this.notify(id);
    }

    /**
     * 清除存储目录下的全部配置文件（「插件自身」分类里那个动作行使用）。
     *
     * 清的是目录里的文件，不是代码里注册的功能：声明里的 enabled、前端适配与版本区间
     * 都只决定功能加不加载，退役的、甚至已经从插件里删掉的功能留下的配置文件同样要清掉，
     * 否则它们会一直躺在工作区里，谁也看不见、谁也删不掉。
     *
     * 删成功的文件对应把内存态回落默认值并通知订阅者，所以磁盘与内存在这一步就一致了；
     * 有任何一个删不掉就把它们收集起来一次性抛出，让用户看见具体是哪个文件。
     */
    async clearAll(): Promise<void> {
        const failed: string[] = [];
        const cleared: string[] = [];
        const files = await this.storedFiles();
        log.info(`clearing ${files.length} configuration file(s)`);
        // 删的是互不依赖的文件，按有限并发一起删；日志与问题清单仍按文件顺序落，
        // 用户看到的顺序不随完成先后变化。
        const outcomes = await mapLimit(
            files,
            CONFIG_IO_CONCURRENCY,
            async ({storageName}) => ({storageName, status: await removeStoredFile(this.plugin, storageName)}),
        );
        outcomes.forEach(({storageName, status}, index) => {
            if (status.ok) {
                log.info(`cleared ${storageName}`);
                cleared.push(files[index].id);
                return;
            }
            log.warn(`failed to clear ${storageName}: ${status.detail}`);
            failed.push(`${storageName}: ${status.detail}`);
        });
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
     * 导出存储目录下的全部配置，键是功能 id（供本插件自己的导入导出动作行使用）。
     *
     * 读的是文件本身，不是内存里那份配置：当前客户端不加载的功能根本没有内存态，
     * 因此写进文件的才是「配置到底是什么」的唯一依据。
     */
    async exportAll(): Promise<Record<string, FeatureConfig>> {
        const result: Record<string, FeatureConfig> = {};
        const files = await this.storedFiles();
        // 读文件互不依赖：并发读回来，再按目录顺序组装（去重与覆盖语义与逐个读一致）
        const reads = await mapLimit(
            files,
            CONFIG_IO_CONCURRENCY,
            async ({storageName}) => ({storageName, stored: await readStoredFile(this.plugin, storageName)}),
        );
        reads.forEach(({storageName, stored}, index) => {
            if (!isPlainObject(stored)) {
                log.warn(`${storageName} does not hold an object, skipping it in the export`);
                return;
            }
            result[files[index].id] = stored;
        });
        log.info(`exported ${Object.keys(result).length} configuration file(s)`, Object.keys(result));
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
        log.info(`importing ${files.length} configuration file(s)`, {
            known: prepared.map(({id}) => id),
            foreign: foreign.map(({id}) => id),
            skipped,
        });
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

    /** 插件卸载时收尾：清掉订阅者。待写的改动由设置面板在关闭时自己补上。 */
    dispose(): void {
        this.listeners.clear();
        this.prefetched.clear();
    }
}
